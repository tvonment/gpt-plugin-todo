const express = require('express');
const CosmosClient = require('@azure/cosmos').CosmosClient;
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
const databaseId = process.env.COSMOS_DATABASE_ID;
const containerId = process.env.COSMOS_CONTAINER_ID;

// Use the variables in your code
const client = new CosmosClient({ endpoint, key });
const container = client.database(databaseId).container(containerId);

const cors = require('cors');

const allowedOrigins = [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    'https://chat.openai.com'
];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    }
}));
app.use('/.well-known', express.static('.well-known'));
app.use(express.json());

app.get('/', (req, res) => res.send('App Running!'));

app.get('/api/todos', async (req, res) => {
    const querySpec = {
        query: 'SELECT * FROM c'
    };

    try {
        const { resources } = await container.items.query(querySpec).fetchAll();
        res.send(resources);
    } catch (error) {
        console.error(error);
        res.sendStatus(500);
    }
});

app.post('/api/todos', async (req, res) => {
    const { body } = req;

    try {
        const { resource } = await container.items.create(body);
        res.send(resource);
    } catch (error) {
        console.error(error);
        res.sendStatus(500);
    }
});

app.get('/api/todos/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const { resource } = await container.item(id, id).read();
        res.send(resource);
    } catch (error) {
        console.error(error);
        res.sendStatus(404);
    }
});

app.put('/api/todos/:id', async (req, res) => {
    const { id } = req.params;
    const { body } = req;

    try {
        const { resource } = await container.item(id, id).replace(body);
        res.send(resource);
    } catch (error) {
        console.error(error);
        res.sendStatus(500);
    }
});

app.delete('/api/todos/:id', async (req, res) => {
    const { id } = req.params;

    try {
        await container.item(id, id).delete();
        res.sendStatus(204);
    } catch (error) {
        console.error(error);
        res.sendStatus(500);
    }
});

app.listen(port, () => {
    console.log(`App listening on port ${port}`);
});