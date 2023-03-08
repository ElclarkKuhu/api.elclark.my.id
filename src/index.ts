/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

let url: URL
let path: string
let paths: string[]

export interface Env {
	// Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
	JOURNAL_KV: KVNamespace
	//
	// Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
	// MY_DURABLE_OBJECT: DurableObjectNamespace;
	//
	// Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
	// MY_BUCKET: R2Bucket;
	//
	// Example binding to a Service. Learn more at https://developers.cloudflare.com/workers/runtime-apis/service-bindings/
	// MY_SERVICE: Fetcher;
	apikeys: string
}

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext
	): Promise<Response> {
		return handleRequest(request, env)
	},
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
	const version = 'v1'
	const apikeys = env.apikeys.split(',')

	const url = new URL(request.url)
	const path = url.pathname
	const paths = path.split('/')
	const { JOURNAL_KV } = env

	switch (paths.length >= 2 && paths[1] === version && paths[2]) {
		case 'journal': {
			if (paths.length >= 4) {
				const journalId = paths[3]
				switch (request.method) {
					case 'GET': {
						const journal = await JOURNAL_KV.get(journalId)
						if (!journal) {
							return new Response('Journal Not Found!', { status: 404 })
						}
						return new Response(journal, {
							status: 200,
							headers: { 'Content-Type': 'application/json' },
						})
					}
					case 'POST': {
						if (!authenticate(request, apikeys)) {
							return new Response('unauthorized!', { status: 401 })
						}
						const journal = await JOURNAL_KV.get(journalId)
						if (journal) {
							return new Response('Journal already exists!', { status: 409 })
						}
						const body = await request.text()
						await JOURNAL_KV.put(journalId, body)
						return new Response('Journal created!', { status: 201 })
					}
					case 'PUT': {
						if (!authenticate(request, apikeys)) {
							return new Response('unauthorized!', { status: 401 })
						}
						const journal = await JOURNAL_KV.get(journalId)
						if (!journal) {
							return new Response('Journal does not exist!', { status: 404 })
						}
						const body = await request.text()
						await JOURNAL_KV.put(journalId, body)
						return new Response('Journal updated!', { status: 200 })
					}
					case 'DELETE': {
						if (!authenticate(request, apikeys)) {
							return new Response('unauthorized!', { status: 401 })
						}
						const journal = await JOURNAL_KV.get(journalId)
						if (!journal) {
							return new Response('Journal does not exist!', { status: 404 })
						}
						await JOURNAL_KV.delete(journalId)
						return new Response('Journal deleted!', { status: 200 })
					}
					default: {
						return new Response('Method Not Allowed!', { status: 405 })
					}
				}
			}
			return new Response('Bad Request!', { status: 400 })
		}
		case 'journals': {
			switch (request.method) {
				case 'GET': {
					const journals = await JOURNAL_KV.list()
					const journalIds = journals.keys.map((key) => key.name)
					return new Response(JSON.stringify(journalIds), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					})
				}
				default: {
					return new Response('Method Not Allowed!', { status: 405 })
				}
			}
		}
		default: {
			return new Response('Not Found!', { status: 404 })
		}
	}
}

function authenticate(request: Request, apikeys: string[]): boolean {
	const auth = request.headers.get('Authorization')

	if (!auth) {
		return false
	}

	const [type, key] = auth.split(' ')

	if (type !== 'Bearer') {
		return false
	}

	if (!apikeys.includes(key)) {
		return false
	}

	return true
}
