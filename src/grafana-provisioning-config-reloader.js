import fs from 'node:fs'
import os from 'node:os'
import chokidar from 'chokidar'
import debounce from 'debounce'
import picomatch from 'picomatch'
import pRetry, { AbortError } from 'p-retry';
import { v5 as uuidv5 } from 'uuid'

// Grafana environment variables
const GF_SERVER_DOMAIN = process.env['GF_SERVER_DOMAIN'] || 'localhost'
const GF_SERVER_PROTOCOL = process.env['GF_SERVER_PROTOCOL'] || 'http'
const GF_SERVER_HTTP_PORT = process.env['GF_SERVER_HTTP_PORT'] || '3000'
const GF_SERVER_ROOT_URL=`${GF_SERVER_PROTOCOL}://${GF_SERVER_DOMAIN}:${GF_SERVER_HTTP_PORT}`
const GF_SECURITY_ADMIN_USER = process.env['GF_SECURITY_ADMIN_USER'] || 'grafana'
const GF_SECURITY_ADMIN_PASSWORD = process.env['GF_SECURITY_ADMIN_USER'] || 'grafana'
const GF_PATHS_PROVISIONING = process.env['GF_PATHS_PROVISIONING'] || '/etc/grafana/provisioning'

// gf-provisioning-config-reloader
let GRAFANA_PROVISIONING_CONFIG_RELOADER_NODE_ID = process.env['GRAFANA_PROVISIONING_CONFIG_RELOADER_NODE_ID']
const GRAFANA_PROVISIONING_CONFIG_RELOADER_NODE_ID_FILE = process.env['GRAFANA_PROVISIONING_CONFIG_RELOADER_NODE_ID_FILE'] || '/data/node-id'
const GRAFANA_PROVISIONING_CONFIG_RELOADER_DATA_DIR = process.env['GRAFANA_PROVISIONING_CONFIG_RELOADER_DATA_DIR'] || '/data'
const GRAFANA_PROVISIONING_CONFIG_RELOADER_SERVICE_ACCOUNT_FILE = `${GRAFANA_PROVISIONING_CONFIG_RELOADER_DATA_DIR}/serviceaccount.json`

const defaultServiceAccountObject = () => ({
    "email": `${GRAFANA_PROVISIONING_CONFIG_RELOADER_NODE_ID}@gf-provisioning-config-reloader`,
    "login": `gf-provisioning-config-reloader-${GRAFANA_PROVISIONING_CONFIG_RELOADER_NODE_ID}`,
    "password": GRAFANA_PROVISIONING_CONFIG_RELOADER_NODE_ID,
})

/**
 * Send a request to the Grafana API
 * @param {string} path
 * @param {RequestInit} opts
 * @returns 
 */
function request(path, opts = {}) {
    const headers = new Headers(opts.headers)
    delete opts.headers
    if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json')
    }
    if (!headers.has('Authorization')) {
        headers.set('Authorization', `Basic ${generateBasicAuthToken(GF_SECURITY_ADMIN_USER, GF_SECURITY_ADMIN_PASSWORD)}`)
    }
    return fetch(`${GF_SERVER_ROOT_URL}/api/${path}`, { headers, ...opts })
}

function generateBasicAuthToken(username, password) {
    return btoa(`${username}:${password}`)
}

/**
 * Send a POST request to the Grafana API
 * @param {string} path 
 * @param {Record<any, any>} data 
 * @param {RequestInit} opts
 * @returns 
 */
function write(path, data, opts = {}) {
    return request(path, {
        method: 'POST',
        body: JSON.stringify(data),
        ...opts,
    })
}

/**
 * Send a PUT request to the Grafana API
 * @param {string} path 
 * @param {Record<any, any>} data 
 * * @param {RequestInit} opts
 * @returns 
 */
function update(path, data, opts = {}) {
    return request(path, {
        method: 'PUT',
        body: JSON.stringify(data),
        ...opts,
    })
}

// Wait for Grafana to be ready
function waitforgrafana() {
    return pRetry(async () => {
        const response = await fetch(`${GF_SERVER_ROOT_URL}/api/health`)
        if (response.status !== 200) {
            throw new AbortError(`Grafana health check failed with status: ${response.status}`)
        }
    }, { forever: true })
}

function sleep(ms = 0) {
    return new Promise(resolve => setTimeout(resolve, ms * 1000))
}

function generateNodeId() {
    // Check if GRAFANA_PROVISIONING_CONFIG_RELOADER_NODE_ID is set
    if (GRAFANA_PROVISIONING_CONFIG_RELOADER_NODE_ID !== undefined) {
        return
    }

    // Check if GRAFANA_PROVISIONING_CONFIG_RELOADER_NODE_ID_FILE exists
    if (fs.existsSync(GRAFANA_PROVISIONING_CONFIG_RELOADER_NODE_ID_FILE)) {
        return fs.readFileSync(GRAFANA_PROVISIONING_CONFIG_RELOADER_NODE_ID_FILE, 'utf8')
    }

    // Generate a random node id
    console.log("[main] Generate a random node id")
    const nodeId = uuidv5(os.hostname(), uuidv5.DNS)
    fs.writeFileSync(GRAFANA_PROVISIONING_CONFIG_RELOADER_NODE_ID_FILE, nodeId)

    // Set the GRAFANA_PROVISIONING_CONFIG_RELOADER_NODE_ID environment variable
    GRAFANA_PROVISIONING_CONFIG_RELOADER_NODE_ID = nodeId
}

// Create a task that resolves immediately
// This is used for chaining async functions
const task = Promise.resolve()

// Create a matcher for dashboards and datasources
const provisioningDashboardsMatcher = picomatch('**/dashboards/*')
const provisioningDatasourcesMatcher = picomatch('**/datasources/*')

async function main() {
    task
        .then(() => generateNodeId())
        .then(() => sleep(5))
        .then(() => waitforgrafana())
        .then(async () => {
            // Check if GRAFANA_PROVISIONING_CONFIG_RELOADER_SERVICE_ACCOUNT_FILE exists
            if (fs.existsSync(GRAFANA_PROVISIONING_CONFIG_RELOADER_SERVICE_ACCOUNT_FILE)) {
                console.log("[main] Service account already exists, reading from file")
                const bytes = fs.readFileSync(GRAFANA_PROVISIONING_CONFIG_RELOADER_SERVICE_ACCOUNT_FILE, 'utf8')
                const serviceAccount = JSON.parse(bytes)
                return serviceAccount
            }

            // Create a new service account
            console.log('[main] Create a new service account')
            const serviceAccount = defaultServiceAccountObject()
            const response = await write('admin/users', serviceAccount)

            // Parse the response JSON
            const json = await response.json()

            // Check if the response status is not 200
            if (response.status !== 200) {
                throw new Error(`[main] msg="${json.message}" status="${response.status}"`)
            }

            // Write the service account to the file
            console.log('[main] Write the service account to the file')
            fs.writeFileSync(GRAFANA_PROVISIONING_CONFIG_RELOADER_SERVICE_ACCOUNT_FILE, JSON.stringify(serviceAccount, null, 2))

            // Update account permissions
            console.log('[main] Update account permissions')
            const userId = json.id
            await update(`admin/users/${userId}/permissions`, { "isGrafanaAdmin": true, })

            return serviceAccount
        }) // Create service accounts
        .then((serviceAccount) => {
            // Create a base64 encoded token
            console.log(`[main] Generate basic auth token for user "${serviceAccount.login}"`)
            const token = generateBasicAuthToken(serviceAccount.login, serviceAccount.password)
            const Authorization = `Basic ${token}`

            // Create a debounced function to reload the Grafana configuration
            const reload = debounce(function (event, path) {
                if (provisioningDashboardsMatcher(path)) {
                    write('admin/provisioning/dashboards/reload', {}, { headers: [['Authorization', Authorization]] })
                        .then(res => res.json())
                        .then(res => {
                            console.log(`[main] msg="${res.message}" event="${event}" path="${path}"`)
                        })
                        .catch(console.warn)
                }
                if (provisioningDatasourcesMatcher(path)) {
                    write('admin/provisioning/datasources/reload', {}, { headers: [['Authorization', Authorization]] })
                        .then(res => res.json())
                        .then(res => {
                            console.log(`[main] msg="${res.message}" event="${event}" path="${path}"`)
                        })
                        .catch(console.warn)
                }
            }, 500, { immediate: true})

            // Monitor provisioning directory for changes to dashboards and datasources, then reload the provisioned configuration via the Grafana API
            console.log(`[main] Start watching provisioning directory "${GF_PATHS_PROVISIONING}"`)
            chokidar.watch(GF_PATHS_PROVISIONING).on('all', async (event, path) => reload(event, path))
        })
        .catch((err) => {
            console.error(err)
            process.exit(1)
        })

    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, () => {
            console.log(`\n[main] Received signal: ${signal}, exiting...`)
            process.exit(0)
        })
    }

}

main()
