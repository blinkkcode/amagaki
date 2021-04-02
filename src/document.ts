import * as fsPath from 'path';
import * as glob from 'glob';
import * as utils from './utils';

import {Locale, LocaleSet} from './locale';

import {Pod} from './pod';
import {Url} from './url';

const DEFAULT_VIEW = '/views/base.njk';

interface DocumentParts {
  body?: string | null;
  fields?: any;
}

/**
 * Documents represent dynamically rendered pages. The document object controls
 * all aspects of rendering itself, with references to things like its template
 * renderer, its locale, and its content type. A document is defined by a
 * content file within the pod's content directory.
 *
 * The structure of a document's `content` comes in two parts: `fields` and
 * `body`. `fields` represent either a full YAML document, or YAML front matter.
 * For Markdown and HTML-formatted documents, a document's `body` is everything
 * below the front matter delimiter (`---`) or the entire file contents in
 * absence of a front matter delimiter. YAML files may not have a `body`.
 *
 * Documents are grouped into collections. A collection is a directory within
 * the pod's content directory. A `_collection.yaml` file defines a collection.
 *
 * The same document may be available in multiple locales. Each locale has its
 * own document object (documents are instantiated with both a `podPath` and a
 * `locale` parameter). If a `locale` parameter is not provided, the pod's
 * default locale is used to instantiate the document. Localized documents will
 * automatically resolve any localizable elements (such as `!a.String` YAML
 * types or `!a.Localized` YAML types) to their correct locale.
 *
 * Finally, documents may or may not actually be bound to routes. In other
 * words, a document can be a partial document and only used as a data source or
 * input for another document, or it might just be hidden. If a document lacks a
 * `pathFormat`, it won't be generated as an individual route. A document's
 * `url` object is determined by its own `pathFormat` and coupled to the pod's
 * `router`.
 */
export class Document {
  path: string;
  locale: Locale;
  pod: Pod;
  readonly ext: string;
  private parts: DocumentParts;
  private _content?: string | null;
  static SelfReferencedView = 'self';
  static SupportedExtensions = new Set([
    '.md',
    '.html',
    '.njk',
    '.xml',
    '.yaml',
  ]);

  constructor(pod: Pod, path: string, locale: Locale) {
    this.pod = pod;
    this.path = path;
    this.locale = locale;
    this.ext = fsPath.extname(this.path);
    this.parts = {};
  }

  toString() {
    return `[Document: ${this.path} (${this.locale.id})]`;
  }

  /**
   * Lists documents using glob patterns, as outlined by the [`glob`
   * module](https://github.com/isaacs/node-glob#glob-primer).
   *
   * Note the following behavior:
   * - Files prefixed with `_` are ignored.
   * - Only files with supported doc extensions are returned.
   *
   * Various techniques can be used to list docs depending on your needs:
   *
   * ```
   * // All docs within the "pages" collection:
   * Document.list(pod, '/content/pages/**')
   *
   * // Only Markdown docs within the "pages" collection:
   * Document.list(pod, '/content/pages/**\/*.md')
   *
   * // All docs within both the "pages" and "posts" collections:
   * Document.list(pod, ['/content/pages/**', '/content/posts/**'])
   *
   * // All Markdown docs within the entire pod:
   * Document.list(pod, '**\/*.md')
   *
   * // All docs named `index.yaml` within the entire pod:
   * Document.list(pod, '**\/index.yaml')
   * ```
   * @param pod The pod object.
   * @param patterns A list of glob patterns or a single glob pattern. If
   * nothing is supplied, all docs within the pod will be returned.
   */
  static list(pod: Pod, patterns?: string[] | string) {
    let paths: string[] = [];
    if (typeof patterns === 'string') {
      patterns = [patterns];
    }
    patterns = patterns || [`${Pod.DefaultContentPodPath}**/*`];
    patterns.forEach(pattern => {
      paths = paths.concat(
        glob.sync(pattern, {
          cwd: pod.root,
          root: pod.root,
          ignore: '/**/*/_*',
          matchBase: false,
          nodir: true,
        })
      );
    });
    // Include only files with supported extensions.
    paths = paths.filter(path => {
      const ext = fsPath.extname(path);
      return Document.SupportedExtensions.has(ext);
    });
    // Convert paths to Document objects.
    return paths.map(path => {
      // Normalize paths returned by glob. Depending on the glob pattern, the
      // resulting paths may or may not include the pod root.
      if (!path.startsWith(pod.root)) {
        path = fsPath.join(pod.root, path);
      }
      return pod.doc(path.replace(pod.root, ''));
    });
  }

  /**
   * Returns the document's collection object. If no `_collection.yaml` is found
   * within the document's content directory, the directory structure will be
   * walked upwards until locating a `_collection.yaml`.
   */
  get collection() {
    return this.pod.collection(fsPath.dirname(this.path));
  }

  /**
   * Returns the default locale for the document. The default locale of a
   * document can be specified one of three ways, in order:
   * `$localization?defaultLocale` field within the document's fields, the
   * collection's `_collection.yaml`, or the pod's `amagaki.js`.
   */
  get defaultLocale() {
    // TODO: Allow docs and collections to override default locales.
    return this.pod.defaultLocale;
  }

  async render(context?: Record<string, any>): Promise<string> {
    const defaultContext = {
      process: process,
      doc: this,
      env: this.pod.env,
      pod: this.pod,
      a: {
        static: this.pod.staticFile.bind(this.pod),
      },
    };
    if (context) {
      Object.assign(defaultContext, context);
    }

    // When `$view: self` is used, use the document's body as the template.
    if (this.view === Document.SelfReferencedView) {
      const templateEngine = this.pod.engines.getEngineByFilename(this.path);
      return templateEngine.renderFromString(
        this.body as string,
        defaultContext
      );
    }

    const templateEngine = this.pod.engines.getEngineByFilename(this.view);
    return templateEngine.render(this.view, defaultContext);
  }

  /**
   * Returns the document's url object by looking it up in the pod's router. If
   * the document has no url (i.e. if it's a partial document or if it's
   * disabled), `undefined` is returned.
   */
  get url(): Url | undefined {
    return this.pod.router.getUrl('doc', this);
  }

  /**
   * Returns the document's basename.
   *
   * A document's basename is its filename without the extension.
   *
   * The `basename` for `/content/pages/index.yaml` is `index`.
   */
  get basename() {
    return fsPath.basename(this.path).split('.')[0];
  }

  /**
   * Returns the document's relative path within the collection.
   *
   * The `collectionPath` for `/content/pages/sub/path/index.yaml` is `/sub/path`.
   */
  get collectionPath() {
    const documentDirectory = fsPath.dirname(this.path);
    const collectionDirectory = this.collection?.path || '';
    return documentDirectory.slice(collectionDirectory.length);
  }

  /**
   * Returns the document's path format, which the router uses to generate the
   * document's actual `Url` object. The path format is specified in the `$path`
   * key of the document's fields, or if absent, inherited from the
   * `_collection.yaml`. For localized documents, the `$localization?path` key
   * is used instead of the `$path` key. If no `$path` or `$localization?path`
   * is specified, the `pathFormat` is `false`.
   */
  get pathFormat() {
    // TODO: See if this is what we want to do, or if we want path formats to be
    // exclusively defined by the router.
    if (this.locale.id === this.pod.defaultLocale.id) {
      return this.fields?.['path'] || this.collection?.fields?.['$path'];
    }
    return (
      this.fields?.['$localization']?.['path'] ||
      this.collection?.fields?.['$localization']?.['path']
    );
  }

  get view() {
    return (
      this.fields?.['$view'] ||
      this.collection?.fields?.['$view'] ||
      DEFAULT_VIEW
    );
  }

  /**
   * Returns the document's set of locale objects. In order, the locales are
   * determined by the `$localization:locales` from the document's fields, or if
   * not specified, inherited from the `_collection.yaml`, or if not specified
   * there, then `amagaki.js`.
   */
  get locales(): Set<Locale> {
    if (this.fields?.['$localization']?.['locales']) {
      return LocaleSet.fromIds(
        this.fields['$localization']['locales'],
        this.pod
      );
    }
    if (this.collection?.locales) {
      return this.collection.locales;
    }
    return this.pod.locales;
  }

  get fields() {
    if (this.parts.fields) {
      return this.parts.fields;
    }
    if (['.md', '.njk'].includes(this.ext)) {
      this.parts = this.initPartsFromFrontMatter();
    } else {
      const timer = this.pod.profiler.timer(
        'document.fields.localize',
        'Document fields localization'
      );
      try {
        this.parts.fields = utils.localizeData(
          this.pod.readYaml(this.path),
          this.locale
        );
      } finally {
        timer.stop();
      }
    }
    return this.parts.fields;
  }

  get content(): string | null {
    if (this._content !== undefined) {
      return this._content;
    }
    this._content = this.pod.readFile(this.path);
    return this._content;
  }

  get body() {
    if (this.parts.body !== null) {
      return this.parts.body;
    }
    if (this.ext === '.yaml') {
      this.parts.body = '';
    } else if (this.ext === '.md') {
      this.parts = this.initPartsFromFrontMatter();
    }
    return this.parts.body;
  }

  private initPartsFromFrontMatter(): DocumentParts {
    // If the body value is not undefined, assume the front matter has been split.
    if (this.parts.body !== undefined) {
      return this.parts;
    }
    const result = utils.splitFrontMatter(this.content);
    return {
      body: result.body || null,
      fields: result.frontMatter
        ? utils.localizeData(
            this.pod.readYamlString(result.frontMatter, this.path),
            this.locale
          )
        : {},
    };
  }

  /**
   * Returns whether a document is servable, given a pod path.
   * @param podPath The pod path of the document.
   */
  static isServable(podPath: string) {
    const basePath = fsPath.basename(podPath);
    const ext = fsPath.extname(podPath);
    return Document.SupportedExtensions.has(ext) && !basePath.startsWith('_');
  }
}
