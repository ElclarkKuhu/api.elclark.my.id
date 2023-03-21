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
		const { pathname } = new URL(request.url)

		const paths = pathname.split('/').filter(Boolean)

		if (paths[0] !== apiVersion) {
			return new Response('Not Found', { status: 404 })
		}

		if (paths[1] === 'blog') {
			const blogSlug = paths[2]

			if (!blogSlug) {
				return new Response('Not Found', { status: 404 })
			}

			if (method === 'GET') {
				const post = (await BLOGS_KV.get(blogSlug, { type: 'json' })) as Post

				if (!post) {
					return new Response('Not Found', { status: 404 })
				}

				if (post.visibility === 'private') {
					const session = await getCookies(headers, 'session')

					if (!session) {
						return new Response('Unauthorized', { status: 401 })
					}

					const sessionData = (await SESSIONS_KV.get(session, {
						type: 'json',
					})) as SessionData

					if (!sessionData) {
						return new Response('Unauthorized', { status: 401 })
					}

					if (sessionData.user.username !== post.author) {
						if (sessionData.user.role !== 'admin') {
							return new Response('Unauthorized', { status: 401 })
						}
					}
				}

				return new Response(JSON.stringify(post), {
					headers: {
						'Content-Type': 'application/json',
					},
				})
			}

			if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
				const session = await getCookies(headers, 'session')

				if (!session) {
					return new Response('Unauthorized', { status: 401 })
				}

				const sessionData = (await SESSIONS_KV.get(session, {
					type: 'json',
				})) as SessionData

				if (!sessionData) {
					return new Response('Unauthorized', { status: 401 })
				}

				if (
					sessionData.user.role !== 'admin' &&
					sessionData.user.role !== 'editor'
				) {
					return new Response('Unauthorized', { status: 401 })
				}

				if (sessionData.user.banned) {
					return new Response('Unauthorized', { status: 401 })
				}

				if (method === 'DELETE') {
					await BLOGS_KV.delete(blogSlug)

					return new Response('OK', { status: 200 })
				}

				if (method === 'POST' || method === 'PUT') {
					const body: PostPostBody = await request.json()

					if (!body) {
						return new Response('Bad Request', { status: 400 })
					}

					const { title, content, visibility } = body

					if (method === 'POST') {
						if (!title || !content || !visibility) {
							return new Response('Bad Request', { status: 400 })
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
								visibility,
							},
						})

						return new Response('Created', { status: 201 })
					}

					if (method === 'PUT') {
						let post = (await BLOGS_KV.get(blogSlug, {
							type: 'json',
						})) as Post

						if (!post) {
							return new Response('Not Found', { status: 404 })
						}

						if (sessionData.user.username !== post.author) {
							if (sessionData.user.role !== 'admin') {
								return new Response('Unauthorized', {
									status: 401,
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
								visibility: post.visibility,
							},
						})

						return new Response('OK', { status: 200 })
					}
				}
			}

			return new Response('Method Not Allowed', { status: 405 })
		}

		return new Response('Not Found', { status: 404 })
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
