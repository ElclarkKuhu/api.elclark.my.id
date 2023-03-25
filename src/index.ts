export interface Env {
	BLOGS_KV: KVNamespace
	SESSIONS_KV: KVNamespace
	USERS_KV: KVNamespace
	INDEXES_KV: KVNamespace
}

export interface Post {
	title: string
	featuredImage?: string
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

export interface PostBody {
	title: string
	featuredImage?: string
	content: string
	visibility: string
}

export interface Index {
	meta: Post[]
	updated: string
}

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,OPTIONS',
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

		const url = new URL(request.url)
		const { BLOGS_KV, SESSIONS_KV, USERS_KV, INDEXES_KV } = env
		const { method, headers } = request
		const { pathname, search } = url

		const paths = pathname.split('/').filter(Boolean)

		if (paths[0] !== apiVersion) {
			return new Response('Not Found', { status: 404, headers: corsHeaders })
		}

		if (paths[1] === 'blog') {
			const postSlug = paths[2]

			if (!postSlug) {
				if (method === 'GET') {
					const cacheKey = new Request(url.toString(), request)
					const cache = caches.default

					let response = await cache.match(cacheKey)

					if (!response) {
						const searchParams = new URLSearchParams(search)
						const limit = Number(searchParams.get('limit')) || 10
						const offset = Number(searchParams.get('offset')) || undefined

						response = new Response(
							JSON.stringify(
								await getPosts(USERS_KV, INDEXES_KV, limit, offset, 'public')
							),
							{
								headers: {
									'Content-Type': 'application/json',
									...corsHeaders,
								},
							}
						)

						response.headers.append('Cache-Control', 's-maxage=3600')
						ctx.waitUntil(cache.put(cacheKey, response.clone()))
					} else {
						console.log(`Cache hit for ${url.toString()}`)
					}

					return response
				}

				return new Response('Method Not Allowed', {
					status: 405,
					headers: corsHeaders,
				})
			}

			if (method === 'GET') {
				const cacheKey = new Request(url.toString(), request)
				const cache = caches.default

				let response = await cache.match(cacheKey)

				if (!response) {
					const post = (await BLOGS_KV.get(postSlug, { type: 'json' })) as Post

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

					const author = (await USERS_KV.get(post.author, {
						type: 'json',
					})) as any

					if (!author) {
						return new Response('Internal Server Error', {
							status: 500,
							headers: corsHeaders,
						})
					}

					delete author.password
					post.author = author

					response = new Response(JSON.stringify(post), {
						headers: {
							'Content-Type': 'application/json',
							...corsHeaders,
						},
					})

					response.headers.append('Cache-Control', 's-maxage=3600')
					ctx.waitUntil(cache.put(cacheKey, response.clone()))
				} else {
					console.log(`Cache hit for ${url.toString()}`)
				}

				return response
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
					await BLOGS_KV.delete(postSlug)
					await updateIndex(INDEXES_KV, 'remove', 'blogs', postSlug)
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

					let postGet = (await BLOGS_KV.get(postSlug, {
						type: 'json',
					})) as Post

					if (method === 'POST') {
						if (!title || !content || !visibility) {
							return new Response('Bad Request', {
								status: 400,
								headers: corsHeaders,
							})
						}

						if (postGet) {
							return new Response('Conflict', {
								status: 409,
								headers: corsHeaders,
							})
						}

						const post: Post = {
							title,
							featuredImage,
							slug: postSlug,
							author: sessionData.user.username,
							date: new Date().toISOString(),
							content,
							visibility,
						}

						await BLOGS_KV.put(postSlug, JSON.stringify(post))

						await updateIndex(INDEXES_KV, 'set', 'blogs', postSlug, post)

						return new Response('Created', {
							status: 201,
							headers: corsHeaders,
						})
					}

					if (method === 'PUT') {
						if (!postGet) {
							return new Response('Not Found', {
								status: 404,
								headers: corsHeaders,
							})
						}

						if (sessionData.user.username !== postGet.author) {
							if (sessionData.user.role !== 'admin') {
								return new Response('Unauthorized', {
									status: 401,
									headers: corsHeaders,
								})
							}
						}

						if (title) {
							postGet.title = title
						}

						if (content) {
							postGet.content = content
						}

						if (visibility) {
							postGet.visibility = visibility
						}

						if (featuredImage) {
							postGet.featuredImage = featuredImage
						}

						postGet.updated = new Date().toISOString()

						await BLOGS_KV.put(postSlug, JSON.stringify(postGet))
						await updateIndex(INDEXES_KV, 'set', 'blogs', postSlug, postGet)

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
				const offset = Number(searchParams.get('offset')) || undefined

				return new Response(
					JSON.stringify(
						await getPosts(
							USERS_KV,
							INDEXES_KV,
							limit,
							offset,
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

		// if (paths[1] === 'init') {
		// 	if (paths[2]) {
		// 		if (method === 'GET') {
		// 			await INDEXES_KV.put(
		// 				paths[2],
		// 				JSON.stringify({
		// 					meta: [],
		// 					updated: new Date().toISOString(),
		// 				} as Index)
		// 			)

		// 			return new Response('paths[2]', { status: 200, headers: corsHeaders })
		// 		}
		// 	}
		// }

		return new Response('Not Found', { status: 404, headers: corsHeaders })
	},
}

async function getSessionId(headers: Headers) {
	const auth = headers.get('Authorization')

	return auth?.startsWith('Bearer ') ? auth.slice(7) : null
}

async function getPosts(
	USERS_KV: KVNamespace,
	INDEXES_KV: KVNamespace,
	limit: number,
	offset: number | undefined,
	visibility: 'public' | 'private' | 'all',
	author?: string | undefined,
	role?: string | undefined
) {
	limit = Math.min(limit, 100)

	const list = (await INDEXES_KV.get('blogs', { type: 'json' })) as Index

	if (!list || list.meta.length === 0) {
		return {
			posts: [],
			completed: true,
		}
	}

	let posts: Post[] = []
	let users = new Map()

	let i = 0
	let completed = true

	for (const {
		title,
		featuredImage,
		slug,
		date,
		author: authorId,
		visibility: postVisibility,
	} of list.meta) {
		if (offset) {
			if (i < offset) {
				i++
				continue
			}
		}

		if (visibility !== 'all') {
			if (visibility !== postVisibility) {
				continue
			}
		}

		if (author && author !== author) {
			if (role !== 'admin') {
				continue
			}
		}

		let user = users.get(author)

		if (!user) {
			user = await USERS_KV.get(authorId, {
				type: 'json',
			})

			delete user.password
			users.set(author, user)
		}

		posts.push({
			title,
			featuredImage,
			slug,
			date,
			author: user,
			visibility: postVisibility,
		})

		if (posts.length === limit) {
			completed = false
			break
		}
	}

	return {
		posts,
		completed,
	} as {
		posts: Post[]
		completed: boolean
	}
}

async function updateIndex(
	INDEXES_KV: KVNamespace,
	action: 'set' | 'remove',
	indexId: string,
	slug: string,
	metadata?: Post
) {
	const index = (await INDEXES_KV.get(indexId, { type: 'json' })) as Index

	switch (action) {
		case 'set':
			if (!metadata) {
				throw new Error('Metadata is required')
			}

			const existing = index.meta.find((post) => post.slug === slug)

			if (existing) {
				index.meta = index.meta.filter((post) => post.slug !== slug)
			}

			index.meta.push({ ...metadata, slug })
			break
		case 'remove':
			index.meta = index.meta.filter((post) => post.slug !== slug)
			break
	}

	index.updated = new Date().toISOString()
	await INDEXES_KV.put(indexId, JSON.stringify(index))
}
