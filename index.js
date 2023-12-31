const express = require('express');
const session = require('express-session');

const axios = require('axios');
const CosmosClient = require('@azure/cosmos').CosmosClient;

require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const host = process.env.HOST;

const client_id = process.env.AZURE_AD_CLIENT_ID;
const client_secret = process.env.AZURE_AD_CLIENT_SECRET;
const redirect_uri = process.env.AZURE_AD_REDIRECT_URI;

const oauth_client_url = process.env.OAUTH_CLIENT_URL;
const token_url = host + "/token";
const openai = process.env.OPENAI_TOKEN;

const plugin_url = process.env.PLUGIN_URL;

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
const databaseId = process.env.COSMOS_DATABASE_ID;
const containerId = process.env.COSMOS_CONTAINER_ID;

const fs = require('fs');
const manifestTemplate = require('./.well-known/ai-plugin.template.json');
const manifest = {
    ...manifestTemplate,
    auth: {
        ...manifestTemplate.auth,
        client_url: oauth_client_url,
        authorization_url: token_url,
        verification_tokens: {
            ...manifestTemplate.auth.verification_tokens,
            openai: openai
        }
    },
    api: {
        ...manifestTemplate.api,
        url: host + "/.well-known/openapi.yaml"
    },
    logo_url: host + "/.well-known/logo.png"
};
fs.writeFileSync('./.well-known/ai-plugin.json', JSON.stringify(manifest, null, 2));

// Use the variables in your code
const client = new CosmosClient({ endpoint, key });
const container = client.database(databaseId).container(containerId);
const sessionsdatabase = client.database("sessionstore");
const sessionscontainer = sessionsdatabase.container("sessions");

class CosmosDBStore extends session.Store {
    async get(sid, callback) {
        console.log("Get SID: ", sid);
        const querySpec = {
            query: "SELECT * FROM c WHERE c.sessionId = @sessionId",
            parameters: [{ name: "@sessionId", value: sid }],
        };

        try {
            const { resources } = await sessionscontainer.items.query(querySpec).fetchAll();
            const session = resources[0] ? resources[0].session : null;
            callback(null, session);
        } catch (err) {
            callback(err);
        }
    }

    async set(sid, session, callback) {
        console.log("Set Session: ", session);
        console.log("Set SID: ", sid);
        try {
            await sessionscontainer.items.upsert({ sid, session });
            callback(null);
        } catch (err) {
            callback(err);
        }
    }

    async destroy(sid, callback) {
        const querySpec = {
            query: "SELECT * FROM c WHERE c.sessionId = @sessionId",
            parameters: [{ name: "@sessionId", value: sid }],
        };

        try {
            const { resources } = await sessionscontainer.items.query(querySpec).fetchAll();
            if (resources.length > 0) {
                await sessionscontainer.item(resources[0].id).delete();
            }
            callback(null);
        } catch (err) {
            callback(err);
        }
    }
}

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

app.use(session({
    secret: 'test-secret-tobe-changed',
    resave: false,
    saveUninitialized: true,
    store: new CosmosDBStore,
}));

app.get('/', (req, res) => res.send('App Running!'));

app.get('/me', async (req, res) => {
    // Retrieve the access token from the session cookie
    const accessToken = req.session.accessToken;

    console.log("TOKEN Session: ", accessToken);

    if (!accessToken) {
        res.redirect('/auth');
        return;
    }

    // Use the access token to make requests to the Microsoft Graph API
    const { data } = await axios.get('https://graph.microsoft.com/v1.0/me', {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    res.json(data);
});

// This endpoint is for redirecting the user to the Azure AD's authorization page
app.get('/auth', (req, res) => {
    console.log("Auth start")
    const queryParams = new URLSearchParams({
        response_type: 'code',
        client_id: client_id,
        redirect_uri: redirect_uri,
        scope: 'User.Read',
    });
    res.redirect(`https://login.microsoftonline.com/2bbd7e41-02c9-4b4e-8168-339f900c4319/oauth2/v2.0/authorize?${queryParams}`);
});

// This endpoint is for handling the redirect from Azure AD with the authorization code
app.get('/auth/callback', async (req, res) => {
    const authCode = req.query.code;
    console.log("Auth Code: ", authCode)

    try {
        const params = new URLSearchParams();
        params.append('grant_type', 'authorization_code');
        params.append('client_id', client_id);
        params.append('client_secret', client_secret);
        params.append('redirect_uri', redirect_uri);
        params.append('code', authCode);

        const { data } = await axios.post('https://login.microsoftonline.com/2bbd7e41-02c9-4b4e-8168-339f900c4319/oauth2/v2.0/token', params, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        // Here, you would typically save the access token for the user in your database
        // For simplicity, I'm just sending it back in the response

        req.session.accessToken = data.access_token;
        console.log("Data Retrieved: ", data);
        res.redirect(plugin_url)
    } catch (error) {
        console.error(error);
        res.sendStatus(500);
    }
});

app.get('/token', (req, res) => {
    const accessToken = req.session.accessToken;
    res.json({ access_token: accessToken, token_type: "Bearer" });
});

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