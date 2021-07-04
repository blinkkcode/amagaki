import {LocaleSet, LocalizableData} from '../locale';

import {Document} from '../document';
import {ExecutionContext} from 'ava';
import {Pod} from '../pod';
import {TranslationString} from '../string';
import test from 'ava';

test('Inbuilt YAML types', (t: ExecutionContext) => {
  const pod = new Pod('./fixtures/yamlTypes/');
  const doc = pod.doc('/content/pages/index.yaml') as Document;
  t.deepEqual(doc.fields.doc.simple, pod.doc('/content/pages/index.yaml'));
  t.deepEqual(
    doc.fields.doc.options,
    pod.doc('/content/pages/index.yaml', pod.locale('en'))
  );
  t.deepEqual(
    doc.fields.docs.simple,
    pod.docs(['/content/pages/index.yaml', '/content/posts/2019-01-06.md'])
  );
  t.deepEqual(
    doc.fields.docs.options1,
    pod.docs(['/content/posts/**'], {sort: 'order'})
  );
  t.deepEqual(
    doc.fields.docs.options2,
    pod.docs(['/content/posts/**'], {sort: 'order'})
  );
  t.deepEqual(doc.fields.collection, pod.collection('/content/pages/'));
  t.deepEqual(
    doc.fields.collections.simple,
    pod.docs(['/content/pages/', '/content/posts/'])
  );
  t.deepEqual(
    doc.fields.collections.options1,
    pod.docs(['/content/pages/'], {sort: 'order'})
  );
  t.deepEqual(
    doc.fields.collections.options2,
    pod.docs(['/content/pages/', '/content/posts/'], {sort: 'order'})
  );
  t.deepEqual(doc.fields.locale, pod.locale('de'));
  t.deepEqual(doc.fields.locales, LocaleSet.fromIds(['de', 'ja'], pod));
  t.deepEqual(doc.fields.staticFile, pod.staticFile('/src/static/file.txt'));
  t.deepEqual(doc.fields.string.simple, pod.string({value: 'Hello World'}));
  t.deepEqual(
    doc.fields.string.options,
    pod.string({prefer: 'New Value', value: 'Old Value'})
  );
  t.deepEqual(doc.fields.yaml.simple, pod.readYaml('/content/pages/page.yaml'));
  t.deepEqual(doc.fields.yaml.deep1, 'value1');
  t.deepEqual(doc.fields.yaml.deep2, 'value3');
  t.deepEqual(doc.fields.IfEnvironment, 'Default Value');
  t.deepEqual(doc.fields.IfLocale, 'en Value');
  t.deepEqual(doc.fields.meta, {foo: {bar: 'value'}});
  t.deepEqual(doc.fields.metaFoo, {bar: 'value'});
  t.deepEqual(doc.fields.metaFooBarBaz, undefined);

  const deDoc = pod.doc(
    '/content/pages/index.yaml',
    pod.locale('de')
  ) as Document;
  t.deepEqual(deDoc.fields.IfLocale, 'de Value');
  t.deepEqual(
    deDoc.fields.doc.options,
    pod.doc('/content/pages/index.yaml', pod.locale('de'))
  );

  const jaDoc = pod.doc(
    '/content/pages/index.yaml',
    pod.locale('ja')
  ) as Document;
  t.deepEqual(jaDoc.fields.IfLocale, 'Default Value');
});

test('Async YAML types', async (t: ExecutionContext) => {
  const pod = new Pod('./fixtures/yamlTypes/');
  const doc = pod.doc('/content/pages/asyncType.yaml') as Document;
  t.true(doc.fields.asyncKey.constructor.name === 'AsyncFunction');
  // Prior to resolving, the field is a function.
  t.true(typeof doc.fields.asyncKey === 'function');
  await doc.render();
  t.deepEqual(
    doc.fields.asyncKey,
    'ASYNC-TYPE-VALUE from /content/pages/asyncType.yaml'
  );
  // After resolving, the field has changed to its resolved value, which is a
  // string in this case.
  t.true(typeof doc.fields.asyncKey === 'string');
});

test('IfEnvironment', (t: ExecutionContext) => {
  const pod = new Pod('./fixtures/yamlTypes/', {
    dev: false,
    host: 'example.com',
    name: 'prod',
    scheme: 'https',
  });
  const doc = pod.doc('/content/pages/index.yaml') as Document;
  t.deepEqual(doc.fields.IfEnvironment, 'Prod Value');
});

test('IfLocale', (t: ExecutionContext) => {
  const sampleYaml = `!IfLocale 
default: base
de: de
`;

  const pod = new Pod('./fixtures/yamlTypes/');
  const localizableData = new LocalizableData(pod, {
    default: 'base',
    de: 'de',
  });
  t.deepEqual(sampleYaml, pod.dumpYaml(localizableData));
  t.deepEqual(localizableData, pod.readYamlString(sampleYaml));
});

test('!pod.string default', (t: ExecutionContext) => {
  const sampleString = '!pod.string foo\n';
  const pod = new Pod('./fixtures/yamlTypes/');
  const translationString = new TranslationString(
    pod,
    {
      value: 'foo',
    },
    pod.defaultLocale
  );
  t.deepEqual(sampleString, pod.dumpYaml(translationString));
  t.deepEqual(translationString, pod.readYamlString(sampleString));
});

test('!pod.string preferred', (t: ExecutionContext) => {
  const sampleString = `!pod.string 
prefer: Preferred String
value: Default String
`;
  const pod = new Pod('./fixtures/yamlTypes/');
  const translationString = new TranslationString(
    pod,
    {
      prefer: 'Preferred String',
      value: 'Default String',
    },
    pod.defaultLocale
  );
  t.deepEqual(sampleString, pod.dumpYaml(translationString));
  t.deepEqual(translationString, pod.readYamlString(sampleString));
});
