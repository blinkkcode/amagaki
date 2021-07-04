import * as nunjucks from 'nunjucks';
import * as utils from '../utils';

import {CommonUrlOptions, Url, Urlable} from '../url';

import {Document} from '../document';
import {PluginComponent} from '../plugins';
import {Pod} from '../pod';
import {TemplateEngineComponent} from '../templateEngine';
import {Translatable} from '../locale';
import {formatBytes} from '../utils';
import marked from 'marked';

/**
 * Built-in Nunjucks filters.
 */
export class NunjucksBuiltInFilters {
  /**
   * Awaits an async function. Usage: `{{asyncFunction()|await}}`
   * @param func The async function to await.
   * @param callback The callback invoked by async Nunjucks filters.
   */
  static async await(func: Function, callback: Function) {
    try {
      callback(null, await func);
    } catch (err) {
      callback(err);
    }
  }

  /**
   * Formats bytes in a human-readable way.
   * @param value Number in bytes.
   * @returns Bytes formatted in a human-readable way.
   */
  static formatBytes(value: number) {
    return formatBytes(value);
  }

  /**
   * Converts Markdown to HTML.
   * @param value Markdown to convert.
   * @returns Markdown converted to HTML.
   */
  static markdown(value: string) {
    if (!value) {
      return '';
    }
    return marked(value);
  }

  /**
   * Returns a URL relative to the current document.
   * @param this Nunjucks context.
   * @param value Destination URL.
   * @returns The URL relative to the current document.
   */
  static relative(this: any, value: Document | string) {
    return Url.relative(value, this.ctx.doc);
  }

  /**
   * Returns a URL formatted in a common way, given a `Urlable` object.
   * A `Urlable` object is an object that may have a URL associated with it,
   * such as a `Document`, `StaticFile`, or a string (assumed to be an absolute
   * URL). An error is thrown if a URL was requested for something that has no URL.
   *
   * Common URLs include a number of sane defaults, such as:
   *
   * - Returns relative URLs.
   * - Includes a `?fingerprint` query parameter for static files.
   * - Localizes documents using the context's locale.
   *
   * Defaults can be changed by supplying options.
   *
   * @param this Nunjucks context.
   * @param value The object to return the URL for.
   * @returns The URL for the given object.
   */
  static url(this: any, object: Urlable, options?: CommonUrlOptions) {
    let commonUrlOptions: CommonUrlOptions = {};
    commonUrlOptions = Object.assign(commonUrlOptions, options);
    commonUrlOptions = Object.assign(commonUrlOptions, {
      context: this.ctx.doc,
    });
    return Url.common(object, commonUrlOptions);
  }

  /**
   * Returns a translation in the current document's locale, for a string.
   * @param this Nunjucks context.
   * @param value A native string or a `String` object.
   * @returns The translation of `value`.
   */
  static t(this: any, value: Translatable) {
    return this.ctx.doc.locale.getTranslation(value, this.ctx.doc);
  }
}

/**
 * Plugin providing support for the nunjucks template engine.
 */
export class NunjucksPlugin implements PluginComponent {
  config: Record<string, any>;
  pod: Pod;
  private shortcutFilters: Record<string, Function>;
  private shortcutGlobals: Record<string, Function>;

  constructor(pod: Pod, config: Record<string, any>) {
    this.pod = pod;
    this.config = config;
    this.shortcutFilters = {};
    this.shortcutGlobals = {};

    // Associate the engine during creation of pod.
    this.pod.engines.associate('.njk', NunjucksTemplateEngine);
  }

  addFilter(filterName: string, filterMethod: Function) {
    this.shortcutFilters[filterName] = filterMethod;
  }

  addGlobal(globalName: string, globalMethod: Function) {
    this.shortcutGlobals[globalName] = globalMethod;
  }

  createTemplateEngineHook(
    templateEngine: TemplateEngineComponent,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    extension: string
  ) {
    if (templateEngine.constructor.name === 'NunjucksTemplateEngine') {
      // Add in the shortcut filters.
      for (const key of Object.keys(this.shortcutFilters)) {
        (templateEngine as NunjucksTemplateEngine).env.addFilter(
          key,
          this.shortcutFilters[key] as any
        );
      }

      // Add in the shortcut globals.
      for (const key of Object.keys(this.shortcutGlobals)) {
        (templateEngine as NunjucksTemplateEngine).env.addGlobal(
          key,
          this.shortcutGlobals[key]
        );
      }
    }
  }
}

/**
 * Template engine providing support for the nunjucks templating.
 */
export class NunjucksTemplateEngine implements TemplateEngineComponent {
  env: nunjucks.Environment;
  pod: Pod;

  constructor(pod: Pod) {
    this.pod = pod;
    const loader = new NunjucksPodLoader(this.pod);
    this.env = new nunjucks.Environment(loader, {
      autoescape: true,
    });
    this.env.addFilter('await', NunjucksBuiltInFilters.await, true);
    this.env.addFilter('formatBytes', NunjucksBuiltInFilters.formatBytes);
    this.env.addFilter('markdown', NunjucksBuiltInFilters.markdown);
    this.env.addFilter('relative', NunjucksBuiltInFilters.relative);
    this.env.addFilter('t', NunjucksBuiltInFilters.t);
    this.env.addFilter('url', NunjucksBuiltInFilters.url);
  }

  render(path: string, context: any): Promise<string> {
    return new Promise((resolve, reject) => {
      this.env.render(path, context, (err, res) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(res || '');
      });
    });
  }

  renderFromString(template: string, context: any): Promise<string> {
    return new Promise((resolve, reject) => {
      this.env.renderString(template, context, (err, res) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(res || '');
      });
    });
  }
}

/**
 * Loader for loading files from the pod for the nunjucks template engine.
 */
class NunjucksPodLoader extends nunjucks.Loader {
  private readonly pod: Pod;
  async = true;

  constructor(pod: Pod) {
    super();
    this.pod = pod;
  }

  getSource(name: string): nunjucks.LoaderSource;
  getSource(
    name: string,
    callback: nunjucks.Callback<Error, nunjucks.LoaderSource>
  ): void;
  getSource(
    name: string,
    callback?: nunjucks.Callback<Error, nunjucks.LoaderSource>
  ): nunjucks.LoaderSource | void {
    const res: nunjucks.LoaderSource = {
      src: '',
      path: '',
      noCache: this.pod.env.dev, // Avoid caching Nunjucks templates in dev.
    };
    const content = this.pod.readFile(name);
    const parts = utils.splitFrontMatter(content);
    res.src = parts.body || '';
    res.path = name;
    if (callback) {
      callback(null, res);
      return;
    }
    return res;
  }
}
