import * as fsPath from 'path';
import express = require('express');
import {Pod} from './pod';
import {StaticRoute} from './router';

export class Server {
  constructor() {}
}

export function createApp(pod: Pod) {
  const app = express();
  app.disable('x-powered-by');
  app.all('/*', async (req: express.Request, res: express.Response) => {
    const route = pod.router.resolve(req.path);
    if (!route) {
      res
        .status(404)
        .sendFile(fsPath.join(__dirname, './static/', 'error-no-route.html'));
      return;
    }
    if (route.provider.type === 'static_dir') {
      res.sendFile(
        pod.getAbsoluteFilePath((route as StaticRoute).staticFile.podPath)
      );
      return;
    } else {
      try {
        const content = await route.build();
        res.set('Content-Type', route.contentType);
        res.send(content);
      } catch (err) {
        res.status(500);
        res.set('Content-Type', 'text/plain');
        res.send(`${err.toString()} ${err.stack}`);
      }
    }
  });

  return app;
}