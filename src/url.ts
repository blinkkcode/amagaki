import * as fsPath from 'path';

import {Document} from './document';
import {Environment} from './environment';
import {StaticFile} from './staticFile';

export interface UrlOptions {
  path: string;
  host?: string;
  scheme?: string;
  port?: string;
  env?: Environment;
}

export interface CommonUrlOptions {
  context?: Urlable;
  fingerprint?: boolean;
  localize?: boolean;
  relative?: boolean;
}

/** Types that can be represented as URLs. */
export type Urlable = StaticFile | Document | string;

const ABSOLUTE_URL_REGEX = new RegExp('^(//|[a-z]+:)', 'i');

export class Url {
  path: string;
  env?: Environment;
  private _host?: string;
  private _scheme?: string;
  private _port?: string;

  /**
   * Creates Url instance. If host, scheme, and port are supplied options, those
   * values will be used. By default, a reference to the pod's environment is
   * used instead.
   */
  constructor(options: UrlOptions) {
    this.path = options.path;
    this.env = options.env;
    this._host = options.host;
    this._scheme = options.scheme;
    this._port = options.port;
  }

  get host() {
    return this._host || this.env?.host;
  }

  get scheme() {
    return this._scheme || this.env?.scheme;
  }

  get port() {
    return this._port || this.env?.port;
  }

  toString() {
    if (this.port) {
      return `${this.scheme}://${this.host}:${this.port}${this.path}`;
    }
    return `${this.scheme}://${this.host}${this.path}`;
  }

  /**
   * Returns a URL relative to another URL. Accepts both `Document` objects
   * (i.e. for returning the URL of one document relative to another) or URLs as
   * strings. Accepts both full URLs or paths only.
   * @param other The `Document` or URL being linked to.
   * @param base The `Document` or URL being linked from.
   * @returns The URL of `other` relative to `base`.
   */
  static relative(other: Urlable, base: Urlable) {
    const otherUrl =
      other instanceof Document || other instanceof StaticFile
        ? other.url?.path
        : other;
    const baseUrl =
      base instanceof Document || base instanceof StaticFile
        ? base.url?.path
        : base;
    if (!otherUrl || !baseUrl || ABSOLUTE_URL_REGEX.test(otherUrl)) {
      return otherUrl;
    }
    const result = fsPath.relative(baseUrl, otherUrl);
    if (!result || result === '/') {
      return otherUrl.endsWith('/') ? './' : '.';
    }
    return otherUrl.endsWith('/') ? `./${result}/` : `./${result}`;
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
   * @param object The object to return the URL for.
   * @returns The URL for the given object.
   */
  static common(object: Urlable, options?: CommonUrlOptions) {
    if (object instanceof StaticFile) {
      if (!object.url) {
        throw new Error(`${object} has no URL.`);
      }
      const resultUrl =
        options?.relative === false || !options?.context
          ? object.url.path
          : Url.relative(object.url.path, options?.context);
      return options?.fingerprint === false
        ? resultUrl
        : `${resultUrl}?fingerprint=${object.fingerprint}`;
    } else if (object instanceof Document) {
      // Ensure the destination document matches the context's locale.
      if (
        options?.context instanceof Document &&
        object.locale !== options?.context.locale &&
        options?.localize !== false
      ) {
        object = object.localize(options?.context.locale);
      }
      if (!object.url) {
        throw new Error(`${object} has no URL.`);
      }
      return options?.relative === false || !options?.context
        ? object.url.path
        : Url.relative(object.url.path, options?.context);
    }
    return options?.relative === false || !options?.context
      ? object
      : Url.relative(object, options?.context);
  }
}
