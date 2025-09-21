// const express = require('express')
// const { generateSlug } = require('random-word-slugs')
// const { ECSClient, RunTaskCommand } = require('@aws-sdk/client-ecs')
// const { Server } = require('socket.io')
// const Redis = require('ioredis')

// const app = express()
// const PORT = 9000

// const subscriber = new Redis('rediss://default:AVNS_nUxCx59VzYALph7_uLR@valkey-24da39e0-manoj1021.d.aivencloud.com:17637')



// const io = new Server({ cors: '*' })

// io.on('connection', socket => {
//     socket.on('subscribe', channel => {
//         socket.join(channel)
//         socket.emit('message', `Joined ${channel}`)
//     })
// })

// io.listen(9002, () => console.log('Socket Server 9002'))

// const ecsClient = new ECSClient({
//     region: 'ap-south-1',
//      credentials: {
//         accessKeyId: 'AKIAWBN7VGULVPSAIQJH',
//         secretAccessKey: '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'
//     }
// })

// const config = {
//     CLUSTER: 'arn:aws:ecs:ap-south-1:415403160855:cluster/builder-cluster',
//     TASK: 'arn:aws:ecs:ap-south-1:415403160855:task-definition/builder-task'
// }

// app.use(express.json())
// app.use(cors())

// app.post('/deploy', async (req, res) => {
//     const { gitURL,slug } = req.body
//     const projectSlug = slug? slug : generateSlug()

//      const command = new RunTaskCommand({
//         cluster: config.CLUSTER,
//         taskDefinition: config.TASK,
//         launchType: 'FARGATE',
//         count: 1,
//         networkConfiguration: {
//             awsvpcConfiguration: {
//                 assignPublicIp: 'ENABLED',
//                 subnets: ['subnet-02ff3431b2de37c6c', 'subnet-0eab007a1aa5d6ad6', 'subnet-0e2699da2a9809dfd'],
//                 securityGroups: ['sg-0b454b62da07826c2']
//             }
//         },
//         overrides: {
//             containerOverrides: [
//                 {
//                     name: 'builder-image',
//                     environment: [
//                         { name: 'GIT_REPOSITORY__URL', value: gitURL },
//                         { name: 'PROJECT_ID', value: projectSlug }
//                     ]
//                 }
//             ]
//         }
//     })

//       await ecsClient.send(command);

//     return res.json({ status: 'queued', data: { projectSlug, url: `http://${projectSlug}.localhost:8000` } })

// })

// async function initRedisSubscribe() {
//     console.log('Subscribed to logs....')
//     subscriber.psubscribe('logs:*')
//     subscriber.on('pmessage', (pattern, channel, message) => {
//         io.to(channel).emit('message', message)
//     })
// }


// initRedisSubscribe()



// app.listen(PORT, () => console.log(`API Server Running..${PORT}`))


const express = require('express')
const { generateSlug } = require('random-word-slugs')
const { ECSClient, RunTaskCommand } = require('@aws-sdk/client-ecs')
const { Server } = require('socket.io')
const cors = require('cors')
const { z } = require('zod')
const { PrismaClient } = require('@prisma/client');
const { createClient } = require('@clickhouse/client')
const { Kafka } = require('kafkajs')
const { v4: uuidv4 } = require('uuid')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = 9000

// Prisma Client
const prisma = new PrismaClient()

// Socket.IO
const io = new Server({ cors: '*' })

io.on('connection', socket => {
    socket.on('subscribe', channel => {
        socket.join(channel)
        socket.emit('message', JSON.stringify({ log: `Subscribed to ${channel}` }))
    })
})

io.listen(9002, () => console.log('Socket Server running on port 9002'))

// Kafka Config (fill values as needed)
const kafka = new Kafka({
    clientId: `api-server`,
    brokers: ['kafka-94baaee-manoj1021.b.aivencloud.com:17649'], 
    //ssl:true, // e.g. ['kafka-broker.aivencloud.com:29092']
    ssl: {
           rejectUnauthorized: true,
           ca: [fs.readFileSync(path.join(__dirname, 'prisma/kafka.pem'), 'utf-8')],
        //    key: fs.readFileSync(path.join(__dirname, 'prisma', 'service.key'), 'utf-8'),
        //    cert: fs.readFileSync(path.join(__dirname, 'prisma', 'service.cert'), 'utf-8'),
    },
    sasl: {
        username: 'avnadmin',
        password: 'AVNS_l3ogQ5LkPDQYh69AnaI',
        mechanism: 'plain'   
    }
})

const consumer = kafka.consumer({ groupId: 'api-server-logs-consumer' })

// ClickHouse Config (fill in your actual connection details)
const client = createClient({
    host: 'https://clickhouse-84cb811-manoj1021.e.aivencloud.com:17637',
    database: 'default',
    username: 'avnadmin',
    password: ''
})

// AWS ECS Client (with your original credentials)
const ecsClient = new ECSClient({
    region: 'ap-south-1',
    credentials: {
        accessKeyId: '',
        secretAccessKey: 'ERSIJS+MFOZZVhumJBe8EBgjQLRewHdeMHUNU+Ru'
    }
})

// ECS Task config (replace with your ECS values)
const config = {
    CLUSTER: 'arn:aws:ecs:ap-south-1:415403160855:cluster/builder-cluster',
    TASK: 'arn:aws:ecs:ap-south-1:415403160855:task-definition/builder-task'
}

// Middleware
app.use(express.json())
app.use(cors())

// -----------------------------
// Routes
// -----------------------------

// Create project
app.post('/project', async (req, res) => {
    const schema = z.object({
        name: z.string(),
        gitURL: z.string()
    })

    const validated = schema.safeParse(req.body)
    if (!validated.success) return res.status(400).json({ error: validated.error })

    const { name, gitURL } = validated.data

    const project = await prisma.project.create({
        data: {
            name,
            gitURL,
            subDomain: generateSlug()
        }
    })

    return res.json({ status: 'success', data: { project } })
})

// Deploy project
app.post('/deploy', async (req, res) => {
    const { projectId } = req.body

    const project = await prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return res.status(404).json({ error: 'Project not found' })

    const deployment = await prisma.deployement.create({
        data: {
            project: { connect: { id: projectId } },
            status: 'QUEUED',
        }
    })

    const command = new RunTaskCommand({
        cluster: config.CLUSTER,
        taskDefinition: config.TASK,
        launchType: 'FARGATE',
        count: 1,
        networkConfiguration: {
            awsvpcConfiguration: {
                assignPublicIp: 'ENABLED',
                subnets: [
                    'subnet-02ff3431b2de37c6c',
                    'subnet-0eab007a1aa5d6ad6',
                    'subnet-0e2699da2a9809dfd'
                ],
                securityGroups: ['sg-0b454b62da07826c2']
            }
        },
        overrides: {
            containerOverrides: [
                {
                    name: 'builder-image', // Use your ECS container name
                    environment: [
                        { name: 'GIT_REPOSITORY__URL', value: project.gitURL },
                        { name: 'PROJECT_ID', value: projectId },
                        { name: 'DEPLOYEMENT_ID', value: deployment.id }
                    ]
                }
            ]
        }
    })

    await ecsClient.send(command)

    return res.json({ status: 'queued', data: { deploymentId: deployment.id } })
})

// Fetch logs from ClickHouse
app.get('/logs/:id', async (req, res) => {
    const id = req.params.id

    const logs = await client.query({
        query: `
            SELECT event_id, deployment_id, log, timestamp 
            FROM log_events 
            WHERE deployment_id = {deployment_id:String}
            ORDER BY timestamp ASC
        `,
        query_params: {
            deployment_id: id
        },
        format: 'JSONEachRow'
    })

    const rawLogs = await logs.json()
    return res.json({ logs: rawLogs })
})

// -----------------------------
// Kafka Consumer: Logs from container
// -----------------------------
async function initKafkaConsumer() {
    await consumer.connect()
    await consumer.subscribe({ topics: ['container-logs'], fromBeginning: true })

    await consumer.run({
        autoCommit: false,
        eachBatch: async ({ batch, heartbeat, commitOffsetsIfNecessary, resolveOffset }) => {
            for (const message of batch.messages) {
                if (!message.value) continue

                const stringMessage = message.value.toString()
                const { PROJECT_ID, DEPLOYEMENT_ID, log } = JSON.parse(stringMessage)

                try {
                    await client.insert({
                        table: 'log_events',
                        values: [{
                            event_id: uuidv4(),
                            deployment_id: DEPLOYEMENT_ID,
                            log
                        }],
                        format: 'JSONEachRow'
                    })

                    io.to(`logs:${DEPLOYEMENT_ID}`).emit('message', JSON.stringify({ log }))

                    resolveOffset(message.offset)
                    await commitOffsetsIfNecessary(message.offset)
                    await heartbeat()
                } catch (err) {
                    console.error('Kafka log insert failed:', err)
                }
            }
        }
    })
}

initKafkaConsumer()

app.listen(PORT, () => console.log(`API Server running on port ${PORT}`))



