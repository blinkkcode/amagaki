import * as _colors from 'colors';
import * as async from 'async';
import * as cliProgress from 'cli-progress';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as fsPath from 'path';
import * as os from 'os';
import * as stream from 'stream';
import * as util from 'util';
import * as utils from './utils';

import {BuildOptions, Route, StaticRoute} from './router';

import {Pod} from './pod';
import minimatch from 'minimatch';

interface Artifact {
  tempPath: string;
  realPath: string;
}

interface PodPathSha {
  path: string;
  sha: string;
}

interface CommitAuthor {
  name: string;
  email: string;
}

interface Commit {
  sha: string;
  author: CommitAuthor;
  message: string;
}

export interface BuildManifest {
  branch: string | null;
  built: string;
  commit: Commit | null;
  files: Array<PodPathSha>;
}

export interface BuildDiffPaths {
  adds: Array<string>;
  edits: Array<string>;
  noChanges: Array<string>;
  deletes: Array<string>;
}

type LocalesToNumMissingTranslations = Record<string, number>;

export interface BuildMetrics {
  memoryUsage: number;
  localesToNumMissingTranslations: LocalesToNumMissingTranslations;
  numMissingTranslations: number;
  numDocumentRoutes: number;
  numStaticRoutes: number;
  outputSizeDocuments: number;
  outputSizeStaticFiles: number;
}

export interface BuildResult {
  metrics: BuildMetrics;
  manifest: BuildManifest;
  diff: BuildDiffPaths;
}

interface CreatedPath {
  route: Route;
  tempPath: string;
  normalPath: string;
  realPath: string;
}

export interface ExportOptions {
  patterns?: string[];
}

export class Builder {
  benchmarkPodPath: string;
  pod: Pod;
  manifestPodPath: string;
  metricsPodPath: string;
  outputDirectoryPodPath: string;
  controlDirectoryAbsolutePath: string;
  static DefaultOutputDirectory = 'build';
  static NumConcurrentBuilds = 40;
  static NumConcurrentCopies = 2000;
  static ShowMoveProgressBarThreshold = 1000;

  constructor(pod: Pod) {
    this.pod = pod;
    // TODO: Right now, this is limited to a sub-directory within the pod. We
    // want that to be the default, but we should also permit building to
    // directories external to the pod.
    this.outputDirectoryPodPath = Builder.DefaultOutputDirectory;
    this.controlDirectoryAbsolutePath = this.pod.getAbsoluteFilePath(
      fsPath.join(this.outputDirectoryPodPath, '.amagaki')
    );
    this.manifestPodPath = fsPath.join(
      this.outputDirectoryPodPath,
      '.amagaki',
      'manifest.json'
    );
    this.metricsPodPath = fsPath.join(
      this.outputDirectoryPodPath,
      '.amagaki',
      'metrics.json'
    );
    this.benchmarkPodPath = fsPath.join(
      this.outputDirectoryPodPath,
      '.amagaki',
      'benchmark.txt'
    );
  }

  static normalizePath(path: string) {
    if (path.endsWith('/')) {
      return `${path}index.html`;
    }
    return fsPath.extname(path) ? path : `${path}/index.html`;
  }

  async getFileSha(outputPath: string) {
    const pipeline = util.promisify(stream.pipeline);
    const hash = crypto.createHash('sha1');
    hash.setEncoding('hex');
    await pipeline(fs.createReadStream(outputPath), hash);
    return hash.read();
  }

  static ensureDirectoryExists(path: string) {
    const dirPath = fsPath.dirname(path);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, {recursive: true});
    }
  }

  static formatProgressBarTime(t: number) {
    const s = t / 1000;
    if (s > 3600) {
      return Math.floor(s / 3600) + 'h ' + Math.round((s % 3600) / 60) + 'm';
    } else if (s > 60) {
      return Math.floor(s / 60) + 'm ' + Math.round(s % 60) + 's';
    } else if (s > 10) {
      return s.toFixed(1) + 's';
    }
    return s.toFixed(2) + 's';
  }

  copyFileAsync(outputPath: string, podPath: string) {
    Builder.ensureDirectoryExists(outputPath);
    return fs.promises.copyFile(
      this.pod.getAbsoluteFilePath(podPath),
      outputPath
    );
  }

  moveFileAsync(beforePath: string, afterPath: string) {
    Builder.ensureDirectoryExists(afterPath);
    return fs.promises.rename(beforePath, afterPath).catch(err => {
      // Handle scenario where temporary directory is on a different device than
      // the destination directory. In this situation, Node cannot move files,
      // but copying files is OK. The temporary directory is cleaned up later by
      // the builder.
      if (err.code === 'EXDEV') {
        return fs.promises.copyFile(beforePath, afterPath);
      }
      throw err;
    });
  }

  writeFileAsync(outputPath: string, content: string) {
    Builder.ensureDirectoryExists(outputPath);
    return fs.promises.writeFile(outputPath, content);
  }

  deleteDirectoryRecursive(path: string) {
    // NOTE: {recursive: true} arg on fs.rmdirSync was not reliable.
    let filePaths = [];
    if (fs.existsSync(path)) {
      filePaths = fs.readdirSync(path);
      filePaths.forEach(filePath => {
        const curPath = fsPath.join(path, filePath);
        if (fs.lstatSync(curPath).isDirectory()) {
          this.deleteDirectoryRecursive(curPath);
        } else {
          fs.unlinkSync(curPath);
        }
      });
      fs.rmdirSync(path);
    }
  }

  deleteOutputFiles(paths: Array<string>) {
    paths.forEach(outputPath => {
      // Delete the file.
      const absOutputPath = this.pod.getAbsoluteFilePath(
        fsPath.join(this.outputDirectoryPodPath, outputPath)
      );
      try {
        fs.unlinkSync(absOutputPath);
      } catch (err) {
        if (err.errno === -2) {
          console.warn(
            `Warning: The Amagaki builder was unable to delete a file while cleaning the build output directory. Avoid manually deleting files outside of the Amagaki build process. -> ${absOutputPath}.`
          );
        } else {
          throw err;
        }
      }
      // Delete the directory if it is empty.
      const dirPath = fsPath.dirname(absOutputPath);
      if (!fs.existsSync(dirPath)) {
        return;
      }
      const innerPaths = fs.readdirSync(dirPath);
      if (innerPaths.length === 0) {
        fs.rmdirSync(dirPath);
      }
    });
  }

  getExistingManifest(): BuildManifest | null {
    const path = this.manifestPodPath;
    if (this.pod.fileExists(path)) {
      return JSON.parse(this.pod.readFile(this.manifestPodPath));
    }
    return null;
  }

  cleanOutputUsingManifests(
    existingManifest: BuildManifest | null,
    newManifest: BuildManifest,
    options?: ExportOptions
  ) {
    const buildDiffPaths: BuildDiffPaths = {
      adds: [],
      edits: [],
      noChanges: [],
      deletes: [],
    };
    // No existing manifest, everything is an "add".
    if (!existingManifest) {
      buildDiffPaths.adds = newManifest.files.map(pathSha => {
        return pathSha.path;
      });
    } else {
      // Build adds, edits, and no changes.
      const existingPathShas: Record<string, string> = {};
      existingManifest.files.forEach(pathSha => {
        existingPathShas[pathSha.path] = pathSha.sha;
      });
      newManifest.files.forEach(newPathSha => {
        if (newPathSha.path in existingPathShas) {
          if (newPathSha.sha === existingPathShas[newPathSha.path]) {
            buildDiffPaths.noChanges.push(newPathSha.path);
          } else {
            buildDiffPaths.edits.push(newPathSha.path);
          }
        } else {
          buildDiffPaths.adds.push(newPathSha.path);
        }
      });
      // Build deletes.
      const newPathShas: Record<string, string> = {};
      newManifest.files.forEach(pathSha => {
        newPathShas[pathSha.path] = pathSha.sha;
      });
      // Incremental builds don't support deletes.
      if (!options?.patterns) {
        existingManifest.files.forEach(pathSha => {
          if (!(pathSha.path in newPathShas)) {
            buildDiffPaths.deletes.push(pathSha.path);
          }
        });
      }
    }
    return buildDiffPaths;
  }

  static createProgressBar(label: string) {
    const isTTY = Boolean(process.env.TERM !== 'dumb' && process.stdin.isTTY);
    const options: cliProgress.Options = {
      format:
        `${label} ({value}/{total}): `.green + '{bar} Total: {customDuration}',
      noTTYOutput: isTTY,
    };
    return new cliProgress.SingleBar(
      options,
      cliProgress.Presets.shades_classic
    );
  }

  async export(options?: ExportOptions): Promise<BuildResult> {
    await this.pod.plugins.trigger('beforeBuild', this);
    const existingManifest = this.getExistingManifest();
    const buildManifest: BuildManifest = {
      branch: null,
      commit: null,
      built: new Date().toString(),
      files: [],
    };
    const buildMetrics: BuildMetrics = {
      localesToNumMissingTranslations: {},
      memoryUsage: 0,
      numDocumentRoutes: 0,
      numMissingTranslations: 0,
      numStaticRoutes: 0,
      outputSizeDocuments: 0,
      outputSizeStaticFiles: 0,
    };
    const bar = Builder.createProgressBar('Building');
    const startTime = new Date().getTime();
    const artifacts: Array<Artifact> = [];
    const tempDirRoot = fs.mkdtempSync(
      fsPath.join(fs.realpathSync(os.tmpdir()), 'amagaki-build-')
    );

    let routes = await this.pod.router.routes();

    // Only build routes matching patterns.
    if (options?.patterns) {
      routes = routes.filter(route =>
        options.patterns?.some(
          pattern =>
            route.podPath &&
            minimatch(
              route.podPath.replace(/^\//, ''),
              pattern.replace(/^\//, ''),
              {
                matchBase: true,
              }
            )
        )
      );
    }

    bar.start(routes.length, artifacts.length, {
      customDuration: Builder.formatProgressBarTime(0),
    });
    const createdPaths: Array<CreatedPath> = [];

    if (routes.length === 0) {
      throw new Error(
        `Nothing to build. No routes found for pod rooted at: ${this.pod.root}. Ensure this is the right directory, and ensure that there is either content or static files to build.`
      );
    }

    // Collect the routes and assemble the temporary directory mapping.
    for (const route of routes) {
      const normalPath = Builder.normalizePath(route.url.path);
      const tempPath = fsPath.join(
        tempDirRoot,
        this.outputDirectoryPodPath,
        normalPath
      );
      const realPath = this.pod.getAbsoluteFilePath(
        fsPath.join(this.outputDirectoryPodPath, normalPath)
      );
      createdPaths.push({
        route: route,
        tempPath: tempPath,
        normalPath: normalPath,
        realPath: realPath,
      });
    }

    // Copy all static files and build all other routes.
    await async.eachLimit(
      createdPaths,
      Builder.NumConcurrentBuilds,
      async createdPath => {
        try {
          // Copy the file, or build it if it's a dynamic route.
          if (createdPath.route.provider.type === 'staticDir') {
            return this.copyFileAsync(
              createdPath.tempPath,
              (createdPath.route as StaticRoute).staticFile.podPath
            );
          } else {
            // Use the url path as a unique timer key.
            const urlPathStub = createdPath.route.urlPath.replace(/\//g, '.');
            const timer = this.pod.profiler.timer(
              `builder.build${urlPathStub}`,
              `Build: ${createdPath.route.urlPath}`,
              {
                path: createdPath.route.podPath,
                type: createdPath.route.provider.type,
                urlPath: createdPath.route.urlPath,
              }
            );
            let content = '';
            try {
              content = await createdPath.route.build();
            } finally {
              timer.stop();
            }
            return this.writeFileAsync(createdPath.tempPath, content);
          }
        } finally {
          artifacts.push({
            tempPath: createdPath.tempPath,
            realPath: createdPath.realPath,
          });
          bar.increment({
            customDuration: Builder.formatProgressBarTime(
              new Date().getTime() - startTime
            ),
          });
        }
      }
    );
    bar.stop();

    // Moving files is pretty fast, but when the number of files is sufficiently
    // large, we want to communicate progress to the user with the progress bar.
    // If less than X files need to be moved, don't show the progress bar,
    // because the operation completes quickly enough.
    const moveBar = Builder.createProgressBar('  Moving'); // Pad the label so it lines up with "Building".
    const showMoveProgressBar =
      artifacts.length >= Builder.ShowMoveProgressBarThreshold;
    const moveStartTime = new Date().getTime();
    if (showMoveProgressBar) {
      moveBar.start(artifacts.length, 0, {
        customDuration: Builder.formatProgressBarTime(0),
      });
    }

    await async.mapLimit(
      createdPaths,
      Builder.NumConcurrentCopies,
      async createdPath => {
        // Start by building the manifest (and getting file shas).
        buildManifest.files.push({
          path: createdPath.normalPath,
          sha: await this.getFileSha(createdPath.tempPath),
        });
        // Then, update the metrics by getting file sizes.
        const statResult = await fs.promises.stat(createdPath.tempPath);
        if (createdPath.route.provider.type === 'staticDir') {
          buildMetrics.numStaticRoutes += 1;
          buildMetrics.outputSizeStaticFiles += statResult.size;
        } else {
          buildMetrics.numDocumentRoutes += 1;
          buildMetrics.outputSizeDocuments += statResult.size;
        }
        // Finally, move the files from the temporary to final locations.
        await this.moveFileAsync(createdPath.tempPath, createdPath.realPath);
        // When done with each file step, increment the progress bar.
        if (showMoveProgressBar) {
          moveBar.increment({
            customDuration: Builder.formatProgressBarTime(
              new Date().getTime() - moveStartTime
            ),
          });
        }
      }
    );

    buildMetrics.memoryUsage = process.memoryUsage().heapUsed;

    if (showMoveProgressBar) {
      moveBar.stop();
    }

    // Clean up.
    this.deleteDirectoryRecursive(tempDirRoot);

    const localesToNumMissingTranslations: LocalesToNumMissingTranslations = {};
    for (const locale of Object.values(this.pod.cache.locales)) {
      if (
        locale === this.pod.defaultLocale ||
        locale.recordedStrings.size === 0
      ) {
        continue;
      }
      localesToNumMissingTranslations[locale.id] = locale.recordedStrings.size;
      buildMetrics.numMissingTranslations += locale.recordedStrings.size;
    }
    buildMetrics.localesToNumMissingTranslations = localesToNumMissingTranslations;

    // Write the manifest and metrics.
    await Promise.all([
      this.writeFileAsync(
        this.pod.getAbsoluteFilePath(this.manifestPodPath),
        JSON.stringify(buildManifest, null, 2)
      ),
      this.writeFileAsync(
        this.pod.getAbsoluteFilePath(this.metricsPodPath),
        JSON.stringify(buildMetrics, null, 2)
      ),
    ]);

    const buildDiff = this.cleanOutputUsingManifests(
      existingManifest,
      buildManifest,
      options
    );

    // After diff has been computed, actually delete files. Incremental builds
    // don't support deletes, so avoid deleting files if building incrementally.
    if (!options?.patterns) {
      this.deleteOutputFiles(buildDiff.deletes);
    }
    const result: BuildResult = {
      diff: buildDiff,
      manifest: buildManifest,
      metrics: buildMetrics,
    };
    this.logResult(buildDiff, buildMetrics, options);
    await this.pod.plugins.trigger('afterBuild', result);
    return result;
  }

  logResult(
    buildDiff: BuildDiffPaths,
    buildMetrics: BuildMetrics,
    options?: ExportOptions
  ) {
    console.log(
      'Memory usage: '.blue + utils.formatBytes(buildMetrics.memoryUsage)
    );
    if (buildMetrics.numDocumentRoutes) {
      console.log(
        'Documents: '.blue +
          `${buildMetrics.numDocumentRoutes} (${utils.formatBytes(
            buildMetrics.outputSizeDocuments
          )}) ${options?.patterns ? '*incremental build' : ''}`
      );
    }
    if (buildMetrics.numStaticRoutes) {
      console.log(
        'Static files: '.blue +
          `${buildMetrics.numStaticRoutes} (${utils.formatBytes(
            buildMetrics.outputSizeStaticFiles
          )})`
      );
    }
    if (buildMetrics.numMissingTranslations) {
      console.log(
        'Missing translations: '.blue +
          Object.entries(buildMetrics.localesToNumMissingTranslations)
            .map(([locale, numMissingTranslations]) => {
              return `${locale} (${numMissingTranslations})`;
            })
            .join(', ')
      );
    }
    console.log(
      'Changes: '.blue +
        `${buildDiff.adds.length} adds, `.green +
        `${buildDiff.edits.length} edits, `.yellow +
        `${buildDiff.deletes.length} deletes`.red
    );
    console.log(
      'Build complete: '.blue +
        this.pod.getAbsoluteFilePath(this.outputDirectoryPodPath)
    );
  }

  async exportBenchmark() {
    // Write the profile benchmark.
    await this.writeFileAsync(
      this.pod.getAbsoluteFilePath(this.benchmarkPodPath),
      this.pod.profiler.benchmarkOutput
    );
  }
}
