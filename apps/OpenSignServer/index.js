import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import express from 'express';
import cors from 'cors';
import { ParseServer } from 'parse-server';
import path from 'path';
import net from 'node:net';
const __dirname = path.resolve();
import http from 'http';
import formData from 'form-data';
import Mailgun from 'mailgun.js';
import { ApiPayloadConverter } from 'parse-server-api-mail-adapter';
import S3Adapter from '@parse/s3-files-adapter';
import FSFilesAdapter from '@parse/fs-files-adapter';
import { app as customRoute } from './cloud/customRoute/customApp.js';
import { exec } from 'child_process';
import { createTransport } from 'nodemailer';
import { appName, cloudServerUrl, serverAppId, smtpenable, smtpsecure, useLocal } from './Utils.js';
import { SSOAuth } from './auth/authadapter.js';
import runDbMigrations from './migrationdb/index.js';
import { validateSignedLocalUrl } from './cloud/parsefunction/getSignedUrl.js';
let fsAdapter;

if (useLocal !== 'true') {
  try {
    // const spacesEndpoint = new AWS.Endpoint(process.env.DO_ENDPOINT);
    const spacesEndpoint = process.env.DO_ENDPOINT?.includes('http')
      ? process.env.DO_ENDPOINT
      : `https://${process.env.DO_ENDPOINT}`; //"e.g https://blr1.digitaloceanspaces.com"
    const s3Options = {
      bucket: process.env.DO_SPACE,
      baseUrl: process.env.DO_BASEURL,
      fileAcl: 'none',
      region: process.env.DO_REGION,
      directAccess: true,
      preserveFileName: true,
      presignedUrl: true,
      presignedUrlExpires: 900,
      s3overrides: {
        credentials: {
          accessKeyId: process.env.DO_ACCESS_KEY_ID,
          secretAccessKey: process.env.DO_SECRET_ACCESS_KEY,
        },
        endpoint: spacesEndpoint,
        signatureVersion: 'v4',
      },
    };
    fsAdapter = new S3Adapter(s3Options);
  } catch (err) {
    console.log('Please provide AWS credintials in env file! Defaulting to local storage.');
    fsAdapter = new FSFilesAdapter({
      filesSubDirectory: 'files', // optional, defaults to ./files
    });
  }
} else {
  fsAdapter = new FSFilesAdapter({
    filesSubDirectory: 'files', // optional, defaults to ./files
  });
}

let transporterMail;
let mailgunClient;
let mailgunDomain;
let isMailAdapter = false;
if (smtpenable) {
  try {
    let transporterConfig = {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 465,
      secure: smtpsecure,
    };

    // ✅ Add auth only if BOTH username & password exist
    const smtpUser = process.env.SMTP_USERNAME;
    const smtpPass = process.env.SMTP_PASS;

    if (smtpUser && smtpPass) {
      transporterConfig.auth = {
        user: process.env.SMTP_USERNAME ? process.env.SMTP_USERNAME : process.env.SMTP_USER_EMAIL,
        pass: smtpPass,
      };
    }
    transporterMail = createTransport(transporterConfig);
    await transporterMail.verify();
    isMailAdapter = true;
  } catch (err) {
    isMailAdapter = false;
    console.log(`Please provide valid SMTP credentials: ${err}`);
  }
} else if (process.env.MAILGUN_API_KEY) {
  try {
    const mailgun = new Mailgun(formData);
    mailgunClient = mailgun.client({
      username: 'api',
      key: process.env.MAILGUN_API_KEY,
    });
    mailgunDomain = process.env.MAILGUN_DOMAIN;
    isMailAdapter = true;
  } catch (error) {
    isMailAdapter = false;
    console.log('Please provide valid Mailgun credentials');
  }
}
const mailsender = smtpenable ? process.env.SMTP_USER_EMAIL : process.env.MAILGUN_SENDER;
export const config = {
  databaseURI:
    process.env.DATABASE_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/dev',
  cloud: function () {
    import('./cloud/main.js');
  },
  appId: serverAppId,
  logLevel: ['error'],
  maxLimit: 500,
  maxUploadSize: '100mb',
  masterKey: process.env.MASTER_KEY, //Add your master key here. Keep it secret!
  masterKeyIps: ['0.0.0.0/0', '::/0'], // '::1'
  serverURL: cloudServerUrl, // Don't forget to change to https if needed
  verifyUserEmails: false,
  publicServerURL: process.env.SERVER_URL || cloudServerUrl,
  // Your apps name. This will appear in the subject and body of the emails that are sent.
  appName: appName,
  allowClientClassCreation: false,
  allowExpiredAuthDataToken: false,
  enableInsecureAuthAdapters: false,
  databaseOptions: { allowPublicExplain: false },
  encodeParseObjectInCloudFunction: true,
  ...(isMailAdapter === true
    ? {
        emailAdapter: {
          module: 'parse-server-api-mail-adapter',
          options: {
            // The email address from which emails are sent.
            sender: appName + ' <' + mailsender + '>',
            // The email templates.
            templates: {
              // The template used by Parse Server to send an email for password
              // reset; this is a reserved template name.
              passwordResetEmail: {
                subjectPath: './files/password_reset_email_subject.txt',
                textPath: './files/password_reset_email.txt',
                htmlPath: './files/password_reset_email.html',
              },
              // The template used by Parse Server to send an email for email
              // address verification; this is a reserved template name.
              verificationEmail: {
                subjectPath: './files/verification_email_subject.txt',
                textPath: './files/verification_email.txt',
                htmlPath: './files/verification_email.html',
              },
            },
            apiCallback: async ({ payload, locale }) => {
              if (mailgunClient) {
                const mailgunPayload = ApiPayloadConverter.mailgun(payload);
                await mailgunClient.messages.create(mailgunDomain, mailgunPayload);
              } else if (transporterMail) await transporterMail.sendMail(payload);
            },
          },
        },
      }
    : {}),
  filesAdapter: fsAdapter,
  auth: { google: { clientId: process.env.GOOGLE_CLIENT_ID }, sso: SSOAuth },
  // for fix Adapter prototype don't match expected prototype
  push: { queueOptions: { disablePushWorker: true } },
};
// Client-keys like the javascript key or the .NET key are not necessary with parse-server
// If you wish you require them, you can set them as options in the initialization above:
// javascriptKey, restAPIKey, dotNetKey, clientKey

export const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(function (req, res, next) {
  req.headers['x-real-ip'] = getUserIP(req);
  const publicUrl = 'https://' + req?.get('host');
  req.headers['public_url'] = publicUrl;
  next();
});

function normalizeIp(value) {
  if (!value) return '';
  let ip = String(value).trim().replace(/^"|"$/g, '');
  if (!ip) return '';

  if (ip.startsWith('[')) {
    const close = ip.indexOf(']');
    if (close > 0) ip = ip.slice(1, close);
  } else {
    const ipv4WithPort = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
    if (ipv4WithPort) ip = ipv4WithPort[1];
  }

  if (ip.toLowerCase().startsWith('::ffff:')) ip = ip.slice(7);
  return net.isIP(ip) ? ip : '';
}

function isPrivateIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) {
    const octets = ip.split('.').map(Number);
    return (
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      octets[0] === 0
    );
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb');
  }
  return true;
}

function getUserIP(request) {
  const candidates = [];
  const add = value => {
    if (Array.isArray(value)) value.forEach(add);
    else if (value) String(value).split(',').forEach(item => candidates.push(item));
  };

  // These headers are set by the trusted reverse-proxy chain. Prefer a real
  // public client address over Docker/private hop addresses.
  add(request.headers['cf-connecting-ip']);
  add(request.headers['true-client-ip']);
  add(request.headers['x-real-ip']);
  add(request.headers['x-forwarded-for']);
  add(request.socket?.remoteAddress);

  const valid = candidates.map(normalizeIp).filter(Boolean);
  return valid.find(ip => !isPrivateIp(ip)) || valid[0] || '';
}

app.use(async function (req, res, next) {
  const isFilePath = req.path?.includes('/files/') || false;
  if (isFilePath && req.method.toLowerCase() === 'get') {
    const serverUrl = new URL(process.env.SERVER_URL);
    const origin = serverUrl.pathname === '/api/app' ? serverUrl.origin + '/api' : serverUrl.origin;
    const fileUrl = origin + req.originalUrl;
    const params = fileUrl?.split('?')?.[1];
    if (params) {
      const fileRes = await validateSignedLocalUrl(fileUrl);
      if (fileRes === 'Unauthorized') {
        return res.status(400).json({ message: 'unauthorized' });
      }
    } else {
      return res.status(400).json({ message: 'unauthorized' });
    }
    next();
  } else {
    next();
  }
});

// Serve static assets from the /public folder
app.use('/public', express.static(path.join(__dirname, '/public')));

// Serve the Parse API on the /parse URL prefix
if (!process.env.TESTING) {
  const mountPath = process.env.PARSE_MOUNT || '/app';
  try {
    const server = new ParseServer(config);
    await server.start();
    app.use(mountPath, server.app);
  } catch (err) {
    console.log(err);
    process.exit();
  }
}
// Mount your custom express app
app.use('/', customRoute);

// Parse Server plays nicely with the rest of your web routes
app.get('/', function (req, res) {
  res.status(200).send('opensign-server is running !!!');
});

if (!process.env.TESTING) {
  const port = process.env.PORT || 8080;
  const httpServer = http.createServer(app);
  // Set the Keep-Alive and headers timeout to 100 seconds
  httpServer.keepAliveTimeout = 100000; // in milliseconds
  httpServer.headersTimeout = 100000; // in milliseconds
  httpServer.listen(port, '0.0.0.0', function () {
    console.log('opensign-server running on port ' + port + '.');
    const isWindows = process.platform === 'win32';
    // console.log('isWindows', isWindows);
    runDbMigrations();
    const migrate = isWindows
      ? `set APPLICATION_ID=${serverAppId}&& set SERVER_URL=${cloudServerUrl}&& set MASTER_KEY=${process.env.MASTER_KEY}&& npx parse-dbtool migrate`
      : `APPLICATION_ID=${serverAppId} SERVER_URL=${cloudServerUrl} MASTER_KEY=${process.env.MASTER_KEY} npx parse-dbtool migrate`;
    exec(migrate, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error: ${error.message}`);
        return;
      }

      if (stderr) {
        console.error(`Error: ${stderr}`);
        return;
      }
      console.log(`Command output: ${stdout}`);
    });
  });
}
