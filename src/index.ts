export interface Env {
	BLOGS_KV: KVNamespace
	SESSIONS_KV: KVNamespace
	USERS_KV: KVNamespace
}

export interface Post {
	title: string
	featuredImage?: string
	author: string | Object
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

export interface PostBody {
	title: string
	featuredImage?: string
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

		const { BLOGS_KV, SESSIONS_KV, USERS_KV } = env
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

					return new Response(
						JSON.stringify(
							await getPosts(BLOGS_KV, USERS_KV, limit, cursor, 'public')
						),
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
					const body: PostBody = await request.json()

					if (!body) {
						return new Response('Bad Request', {
							status: 400,
							headers: corsHeaders,
						})
					}

					const { title, content, visibility, featuredImage } = body

					if (method === 'POST') {
						if (!title || !content || !visibility) {
							return new Response('Bad Request', {
								status: 400,
								headers: corsHeaders,
							})
						}

						const post: Post = {
							title,
							featuredImage,
							slug: blogSlug,
							author: sessionData.user.username,
							date: new Date().toISOString(),
							content,
							visibility,
						}

						await BLOGS_KV.put(blogSlug, JSON.stringify(post), {
							metadata: {
								title,
								featuredImage,
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

						if (featuredImage) {
							post.featuredImage = featuredImage
						}

						post.updated = new Date().toISOString()

						await BLOGS_KV.put(blogSlug, JSON.stringify(post), {
							metadata: {
								title: post.title,
								featuredImage,
								date: post.date,
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

				const searchParams = new URLSearchParams(search)
				const limit = Number(searchParams.get('limit')) || 10
				const cursor = searchParams.get('cursor') || undefined

				return new Response(
					JSON.stringify(
						await getPosts(
							BLOGS_KV,
							USERS_KV,
							limit,
							cursor,
							'all',
							sessionData.user.username,
							sessionData.user.role
						)
					),
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

	return auth?.startsWith('Bearer ') ? auth.slice(7) : null
}

async function getPosts(
	BLOGS_KV: KVNamespace,
	USERS_KV: KVNamespace,
	limit: number,
	cursor: string | undefined,
	visibility: 'public' | 'private' | 'all',
	author?: string | undefined,
	role?: string | undefined
) {
	limit = Math.min(limit, 100)

	const list: any = await BLOGS_KV.list({ limit, cursor })
	if (!list || !list.keys || list.keys.length === 0)
		return {
			posts: [],
			list_complete: true,
			cursor: undefined,
		}

	let posts: Post[] = []
	let users = new Map()

	for (const { name, metadata } of list.keys) {
		if (visibility !== 'all') {
			if (metadata.visibility !== visibility) {
				continue
			}
		}

		if (author && metadata.author !== author) {
			if (role !== 'admin') {
				continue
			}
		}

		let user = users.get(metadata.author)

		if (!user) {
			user = await USERS_KV.get(metadata.author, {
				type: 'json',
			})

			delete user.password
			users.set(metadata.author, user)
		}

		posts.push({
			title: metadata.title,
			featuredImage: metadata.featuredImage,
			slug: name,
			date: metadata.date,
			author: user,
			visibility: metadata.visibility,
		})
	}

	if (posts.length !== limit && !list.list_complete) {
		if (list.cursor) {
			const nextPosts = await getPosts(
				BLOGS_KV,
				USERS_KV,
				limit - posts.length,
				list.cursor,
				visibility,
				author,
				role
			)

			posts = posts.concat(nextPosts.posts)
		}
	}

	return {
		posts,
		list_complete: list.list_complete,
		cursor: list.cursor,
	} as {
		posts: Post[]
		list_complete: boolean
		cursor: string | undefined
	}
}
