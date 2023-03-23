export interface Env {
	BLOGS_KV: KVNamespace
	SESSIONS_KV: KVNamespace
}

export interface Post {
	title: string
	author: string
	date: string
	slug: string
	updated?: string
	content?: string
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

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
	'Access-Control-Allow-Credentials': 'true',
	'Access-Control-Max-Age': '86400',
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
			return new Response('Not Found', { status: 404, headers: corsHeaders })
		}

		if (paths[1] === 'blog') {
			const blogSlug = paths[2]

			if (!blogSlug) {
				if (method === 'GET') {
					const searchParams = new URLSearchParams(search)
					const limit = Number(searchParams.get('limit')) || 10
					const cursor = searchParams.get('cursor') || undefined

					const list: any = await BLOGS_KV.list({ limit, cursor })

					if (!list) {
						return new Response('Not Found', {
							status: 404,
							headers: corsHeaders,
						})
					}

					let posts: Post[] = []

					for (const { name, metadata } of list.keys) {
						posts.push({
							title: metadata.title,
							slug: name,
							date: metadata.date,
							author: metadata.author,
							visibility: metadata.visibility,
						})
					}

					posts = posts.filter((post) => post.visibility !== 'private')

					return new Response(
						JSON.stringify({
							posts,
							list_complete: list.list_complete,
							cursor: list.cursor,
						}),
						{
							headers: {
								'Content-Type': 'application/json',
								...corsHeaders,
							},
						}
					)
				}

				return new Response('Method Not Allowed', {
					status: 405,
					headers: corsHeaders,
				})
			}

			if (method === 'GET') {
				const post = (await BLOGS_KV.get(blogSlug, { type: 'json' })) as Post

				if (!post) {
					return new Response('Not Found', {
						status: 404,
						headers: corsHeaders,
					})
				}

				if (post.visibility === 'private') {
					const session = await getSessionId(headers)

					if (!session) {
						return new Response('Unauthorized', {
							status: 401,
							headers: corsHeaders,
						})
					}

					const sessionData = (await SESSIONS_KV.get(session, {
						type: 'json',
					})) as SessionData

					if (!sessionData) {
						return new Response('Unauthorized', {
							status: 401,
							headers: corsHeaders,
						})
					}

					if (sessionData.user.username !== post.author) {
						if (sessionData.user.role !== 'admin') {
							return new Response('Unauthorized', {
								status: 401,
								headers: corsHeaders,
							})
						}
					}
				}

				return new Response(JSON.stringify(post), {
					headers: {
						'Content-Type': 'application/json',
						...corsHeaders,
					},
				})
			}

			if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
				const session = await getSessionId(headers)

				if (!session) {
					return new Response('Unauthorized', {
						status: 401,
						headers: corsHeaders,
					})
				}

				const sessionData = (await SESSIONS_KV.get(session, {
					type: 'json',
				})) as SessionData

				if (!sessionData) {
					return new Response('Unauthorized', {
						status: 401,
						headers: corsHeaders,
					})
				}

				if (
					sessionData.user.role !== 'admin' &&
					sessionData.user.role !== 'editor'
				) {
					return new Response('Unauthorized', {
						status: 401,
						headers: corsHeaders,
					})
				}

				if (sessionData.user.banned) {
					return new Response('Unauthorized', {
						status: 401,
						headers: corsHeaders,
					})
				}

				if (method === 'DELETE') {
					await BLOGS_KV.delete(blogSlug)

					return new Response('OK', { status: 200, headers: corsHeaders })
				}

				if (method === 'POST' || method === 'PUT') {
					const body: PostPostBody = await request.json()

					if (!body) {
						return new Response('Bad Request', {
							status: 400,
							headers: corsHeaders,
						})
					}

					const { title, content, visibility } = body

					if (method === 'POST') {
						if (!title || !content || !visibility) {
							return new Response('Bad Request', {
								status: 400,
								headers: corsHeaders,
							})
						}

						const post: Post = {
							title,
							slug: blogSlug,
							author: sessionData.user.username,
							date: new Date().toISOString(),
							content,
							visibility,
						}

						await BLOGS_KV.put(blogSlug, JSON.stringify(post), {
							metadata: {
								title,
								date: post.date,
								author: post.author,
								visibility,
							},
						})

						return new Response('Created', {
							status: 201,
							headers: corsHeaders,
						})
					}

					if (method === 'PUT') {
						let post = (await BLOGS_KV.get(blogSlug, {
							type: 'json',
						})) as Post

						if (!post) {
							return new Response('Not Found', {
								status: 404,
								headers: corsHeaders,
							})
						}

						if (sessionData.user.username !== post.author) {
							if (sessionData.user.role !== 'admin') {
								return new Response('Unauthorized', {
									status: 401,
									headers: corsHeaders,
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

						return new Response('OK', { status: 200, headers: corsHeaders })
					}
				}
			}

			return new Response('Method Not Allowed', {
				status: 405,
				headers: corsHeaders,
			})
		}

		if (paths[1] === 'editor') {
			if (method === 'GET') {
				const session = await getSessionId(headers)

				if (!session) {
					return new Response('Unauthorized', {
						status: 401,
						headers: corsHeaders,
					})
				}

				const sessionData = (await SESSIONS_KV.get(session, {
					type: 'json',
				})) as SessionData

				if (!sessionData) {
					return new Response('Unauthorized', {
						status: 401,
						headers: corsHeaders,
					})
				}

				if (
					sessionData.user.role !== 'admin' &&
					sessionData.user.role !== 'editor'
				) {
					return new Response('Unauthorized', {
						status: 401,
						headers: corsHeaders,
					})
				}

				// get list of blogs that the user has access to
				const searchParams = new URLSearchParams(search)
				const limit = Number(searchParams.get('limit')) || 10
				const cursor = searchParams.get('cursor') || undefined

				const list: any = await BLOGS_KV.list({ limit, cursor })

				if (!list) {
					return new Response('Not Found', {
						status: 404,
						headers: corsHeaders,
					})
				}

				let posts: Post[] = []

				for (const { name, metadata } of list.keys) {
					posts.push({
						title: metadata.title,
						slug: name,
						date: metadata.date,
						author: metadata.author,
						visibility: metadata.visibility,
					})
				}

				posts = posts.filter((post) => {
					if (sessionData.user.role === 'admin') {
						return true
					}

					if (sessionData.user.role === 'editor') {
						if (post.visibility === 'public') {
							return true
						}

						if (post.visibility === 'private') {
							if (post.author === sessionData.user.username) {
								return true
							}
						}
					}

					return false
				})

				return new Response(
					JSON.stringify({
						posts,
						list_complete: list.list_complete,
						cursor: list.cursor,
					}),
					{
						headers: {
							'Content-Type': 'application/json',
							...corsHeaders,
						},
					}
				)
			}
		}

		return new Response('Not Found', { status: 404, headers: corsHeaders })
	},
}

async function getSessionId(headers: Headers) {
	const auth = headers.get('Authorization')

	if (!auth) {
		return null
	}

	const [type, token] = auth.split(' ')

	if (type !== 'Bearer') {
		return null
	}

	if (!token) {
		return null
	}

	return token
}
