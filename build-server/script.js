const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const mime = require('mime-types');
const { Kafka } = require('kafkajs');

const s3Client = new S3Client({
    region: 'ap-south-1',
    credentials: {
        accessKeyId: '',
        secretAccessKey: ''
    }
});

const PROJECT_ID = process.env.PROJECT_ID;
const DEPLOYEMENT_ID = process.env.DEPLOYEMENT_ID;

const kafka = new Kafka({
    clientId: `docker-build-server-${DEPLOYEMENT_ID}`,
    brokers: ['kafka-94baaee-manoj1021.b.aivencloud.com:17649'],
    ssl: {
        ca: [fs.readFileSync(path.join(__dirname, 'kafka.pem'), 'utf-8')]
    },
    sasl: {
        username: 'avnadmin',
        password: '',
        mechanism: 'plain'
    }
});

const producer = kafka.producer();

async function publishLog(log) {
    try {
        await producer.send({
            topic: 'container-logs',
            messages: [
                {
                    key: 'log',
                    value: JSON.stringify({ PROJECT_ID, DEPLOYEMENT_ID, log })
                }
            ]
        });
    } catch (err) {
        console.error('Failed to publish log to Kafka:', err);
    }
}

async function init() {
    await producer.connect();

    console.log('Executing script.js');
    await publishLog('Build Started...');

    const outDirPath = path.join(__dirname, 'output');

    const p = exec(`cd ${outDirPath} && npm install && npm run build`);

    p.stdout.on('data', async function (data) {
        const log = data.toString();
        console.log(log);
        await publishLog(log);
    });

    p.stderr?.on('data', async function (data) {
        const errLog = data.toString();
        console.error('Error:', errLog);
        await publishLog(`error: ${errLog}`);
    });

    p.on('close', async function () {
        console.log('Build Complete');
        await publishLog('Build Complete');

        const distFolderPath = path.join(__dirname, 'output', 'dist');
        const distFolderContents = fs.readdirSync(distFolderPath, { recursive: true });

        await publishLog('Starting to upload');

        for (const file of distFolderContents) {
            const filePath = path.join(distFolderPath, file);
            if (fs.lstatSync(filePath).isDirectory()) continue;

            console.log('Uploading', filePath);
            await publishLog(`Uploading ${file}`);

            const command = new PutObjectCommand({
                Bucket: 'vercel-clone-outputs-1',
                Key: `__outputs/${PROJECT_ID}/${file}`,
                Body: fs.createReadStream(filePath),
                ContentType: mime.lookup(filePath) || 'application/octet-stream'
            });

            await s3Client.send(command);
            console.log('Uploaded', filePath);
            await publishLog(`Uploaded ${file}`);
        }

        await publishLog('Done');
        console.log('Done...');
        process.exit(0);
    });
}

init();
