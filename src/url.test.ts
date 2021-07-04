import {Document} from './document';
import {ExecutionContext} from 'ava';
import {Pod} from './pod';
import {StaticFile} from './staticFile';
import {Url} from './url';
import test from 'ava';

test('relative', async (t: ExecutionContext) => {
  t.deepEqual(Url.relative('/foo', '/foo/bar'), './..');
  t.deepEqual(Url.relative('/foo/', '/foo/bar'), './../');
  t.deepEqual(Url.relative('/foo/bar', '/foo/bar'), '.');
  t.deepEqual(Url.relative('/foo/bar/', '/foo/bar'), './');
  t.deepEqual(Url.relative('/foo/bar', '/foo/bar/baz'), './..');
  t.deepEqual(Url.relative('/foo/bar', ''), '/foo/bar');
  t.deepEqual(
    Url.relative('https://example.com', '/foo'),
    'https://example.com'
  );
  t.deepEqual(Url.relative('//example.com', '/foo'), '//example.com');
  t.deepEqual(
    Url.relative('mailto:foo@example.com', '/foo'),
    'mailto:foo@example.com'
  );
  const pod = new Pod('./fixtures/simple/');
  await pod.warmup();
  t.deepEqual(
    Url.relative(
      pod.doc('/content/pages/about.yaml'),
      pod.doc('/content/pages/index.yaml')
    ),
    './about/'
  );
});

test('common', async (t: ExecutionContext) => {
  const pod = new Pod('./fixtures/simple/');
  await pod.warmup();
  const doc1 = pod.doc('/content/pages/index.yaml') as Document;
  const doc2 = pod.doc(
    '/content/pages/about.yaml',
    pod.locale('de')
  ) as Document;
  // No context.
  t.deepEqual(Url.common(doc1), '/');
  // Context, default options.
  t.deepEqual(
    Url.common(doc1, {
      context: doc2,
    }),
    './../'
  );
  // Context, default options, not relative.
  t.deepEqual(
    Url.common(doc1, {
      context: doc2,
      relative: false,
    }),
    '/intl/de/'
  );
  // Context, default options, not localized.
  t.deepEqual(
    Url.common(doc1, {
      context: doc2,
      localize: false,
    }),
    './../../../'
  );
  // Context, default options, not localized, not relative.
  t.deepEqual(
    Url.common(doc1, {
      context: doc2,
      relative: false,
      localize: false,
    }),
    '/'
  );
  const file = pod.staticFile('/static/images/cat.jpg') as StaticFile;
  // No context.
  t.deepEqual(
    Url.common(file),
    '/static/images/cat.jpg?fingerprint=42d9f30a2585cd338a609364740b6493'
  );
  // Context, default options.
  t.deepEqual(
    Url.common(file, {
      context: doc1,
    }),
    './static/images/cat.jpg?fingerprint=42d9f30a2585cd338a609364740b6493'
  );
  t.deepEqual(
    Url.common(file, {
      context: doc2,
    }),
    './../../../static/images/cat.jpg?fingerprint=42d9f30a2585cd338a609364740b6493'
  );
  // Context, no fingerprint.
  t.deepEqual(
    Url.common(file, {
      context: doc2,
      fingerprint: false,
    }),
    './../../../static/images/cat.jpg'
  );
});
