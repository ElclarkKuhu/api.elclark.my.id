export interface Env {
	BLOGS_KV: KVNamespace
	SESSIONS_KV: KVNamespace
}

export interface Post {
	title: string
	author: string
	date: string
	updated?: string
	content: string
	visibility: string
}

export interface SessionData {
	id: string
	created: string
	expires: string
	user: {
		email: string
		emailVerified: boolean
		username: string
		displayName: string
		banned: boolean
		role: string
	}
	ip: string
	useragent: string
}

export interface ListResult {
	keys: [
		{
			name: string
			metadata: {
				title: string
				author: string
				visibility: string
			}
		}
	]
	list_complete: boolean
	cursor: string
}

export interface PostPostBody {
	title: string
	content: string
	visibility: string
}

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext
	): Promise<Response> {
		const apiVersion = 'v1'

		const { BLOGS_KV, SESSIONS_KV } = env
		const { method, headers } = request
		const { pathname, search } = new URL(request.url)

		const paths = pathname.split('/').filter(Boolean)

		if (paths[0] !== apiVersion) {
			return new Response('Not Found', {
				status: 404,
				headers: await corsHeaders(headers),
			})
		}

		if (paths[1] === 'blog') {
			const blogSlug = paths[2]

			if (!blogSlug) {
				if (method === 'GET') {
					const searchParams = new URLSearchParams(search)
					const limit = Number(searchParams.get('limit')) || 10
					const cursor = searchParams.get('cursor') || undefined

					const list = (await BLOGS_KV.list({ limit, cursor })) as ListResult
					const posts = list.keys.filter(
						({ metadata: { visibility } }) => visibility === 'public'
					)

					return new Response(
						JSON.stringify({
							posts,
							list_complete: list.list_complete,
							cursor: list.cursor,
						}),
						{
							headers: {
								'Content-Type': 'application/json',
								...(await corsHeaders(headers)),
							},
						}
					)
				}

				return new Response('Method Not Allowed', {
					status: 405,
					headers: await corsHeaders(headers),
				})
			}

			if (method === 'GET') {
				const post = (await BLOGS_KV.get(blogSlug, { type: 'json' })) as Post

				if (!post) {
					return new Response('Not Found', {
						status: 404,
						headers: await corsHeaders(headers),
					})
				}

				if (post.visibility === 'private') {
					const session = await getCookies(headers, 'session')

					if (!session) {
						return new Response('Unauthorized', {
							status: 401,
							headers: await corsHeaders(headers),
						})
					}

					const sessionData = (await SESSIONS_KV.get(session, {
						type: 'json',
					})) as SessionData

					if (!sessionData) {
						return new Response('Unauthorized', {
							status: 401,
							headers: await corsHeaders(headers),
						})
					}

					if (sessionData.user.username !== post.author) {
						if (sessionData.user.role !== 'admin') {
							return new Response('Unauthorized', {
								status: 401,
								headers: await corsHeaders(headers),
							})
						}
					}
				}

				return new Response(JSON.stringify(post), {
					headers: {
						'Content-Type': 'application/json',
						...(await corsHeaders(headers)),
					},
				})
			}

			if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
				const session = await getCookies(headers, 'session')

				if (!session) {
					return new Response('Unauthorized', {
						status: 401,
						headers: await corsHeaders(headers),
					})
				}

				const sessionData = (await SESSIONS_KV.get(session, {
					type: 'json',
				})) as SessionData

				if (!sessionData) {
					return new Response('Unauthorized', {
						status: 401,
						headers: await corsHeaders(headers),
					})
				}

				if (
					sessionData.user.role !== 'admin' &&
					sessionData.user.role !== 'editor'
				) {
					return new Response('Unauthorized', {
						status: 401,
						headers: await corsHeaders(headers),
					})
				}

				if (sessionData.user.banned) {
					return new Response('Unauthorized', {
						status: 401,
						headers: await corsHeaders(headers),
					})
				}

				if (method === 'DELETE') {
					await BLOGS_KV.delete(blogSlug)

					return new Response('OK', {
						status: 200,
						headers: await corsHeaders(headers),
					})
				}

				if (method === 'POST' || method === 'PUT') {
					const body: PostPostBody = await request.json()

					if (!body) {
						return new Response('Bad Request', {
							status: 400,
							headers: await corsHeaders(headers),
						})
					}

					const { title, content, visibility } = body

					if (method === 'POST') {
						if (!title || !content || !visibility) {
							return new Response('Bad Request', {
								status: 400,
								headers: await corsHeaders(headers),
							})
						}

						const post: Post = {
							title,
							author: sessionData.user.username,
							date: new Date().toISOString(),
							content,
							visibility,
						}

						await BLOGS_KV.put(blogSlug, JSON.stringify(post), {
							metadata: {
								title,
								author: post.author,
								visibility,
							},
						})

						return new Response('Created', {
							status: 201,
							headers: await corsHeaders(headers),
						})
					}

					if (method === 'PUT') {
						let post = (await BLOGS_KV.get(blogSlug, {
							type: 'json',
						})) as Post

						if (!post) {
							return new Response('Not Found', {
								status: 404,
								headers: await corsHeaders(headers),
							})
						}

						if (sessionData.user.username !== post.author) {
							if (sessionData.user.role !== 'admin') {
								return new Response('Unauthorized', {
									status: 401,
									headers: await corsHeaders(headers),
								})
							}
						}

						if (title) {
							post.title = title
						}

						if (content) {
							post.content = content
						}

						if (visibility) {
							post.visibility = visibility
						}

						post.updated = new Date().toISOString()

						await BLOGS_KV.put(blogSlug, JSON.stringify(post), {
							metadata: {
								title: post.title,
								author: post.author,
								visibility: post.visibility,
							},
						})

						return new Response('OK', {
							status: 200,
							headers: await corsHeaders(headers),
						})
					}
				}
			}

			return new Response('Method Not Allowed', {
				status: 405,
				headers: await corsHeaders(headers),
			})
		}

		if (paths[1] === 'editor') {
			if (method === 'GET') {
				const session = await getCookies(headers, 'session')

				if (!session) {
					return new Response('Unauthorized', {
						status: 401,
						headers: await corsHeaders(headers),
					})
				}

				const sessionData = (await SESSIONS_KV.get(session, {
					type: 'json',
				})) as SessionData

				if (!sessionData) {
					return new Response('Unauthorized', {
						status: 401,
						headers: await corsHeaders(headers),
					})
				}

				if (
					sessionData.user.role !== 'admin' &&
					sessionData.user.role !== 'editor'
				) {
					return new Response('Unauthorized', {
						status: 401,
						headers: await corsHeaders(headers),
					})
				}

				// get list of blogs that the user has access to
				const searchParams = new URLSearchParams(search)
				const limit = Number(searchParams.get('limit')) || 10
				const cursor = searchParams.get('cursor') || undefined

				const list = (await BLOGS_KV.list({
					limit,
					cursor,
				})) as ListResult

				const posts = list.keys.filter(
					({ metadata: { author } }) => author === sessionData.user.username
				)

				return new Response(
					JSON.stringify({
						posts,
						list_complete: list.list_complete,
						cursor: list.cursor,
					}),
					{
						headers: {
							'Content-Type': 'application/json',
							...(await corsHeaders(headers)),
						},
					}
				)
			}
		}

		return new Response('Not Found', {
			status: 404,
			headers: await corsHeaders(headers),
		})
	},
}

async function getCookies(headers: Headers, key: string) {
	const cookie = headers.get('Cookie')

	if (!cookie) {
		return null
	}

	const cookies = cookie.split(';')

	for (const cookie of cookies) {
		const [cookieKey, cookieValue] = cookie.split('=')

		if (cookieKey.trim() === key) {
			return cookieValue
		}
	}

	return null
}

async function corsHeaders(headers: Headers) {
	const other = {
		'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie',
		'Access-Control-Allow-Credentials': 'true',
	}

	const origin = headers.get('Origin')

	if (!origin) {
		return {
			'Access-Control-Allow-Origin': '*',
			...other,
		}
	}

	if (origin.endsWith('elclark.my.id')) {
		return {
			'Access-Control-Allow-Origin': origin,
			...other,
		}
	}

	return {
		'Access-Control-Allow-Origin': '*',
		...other,
	}
}
