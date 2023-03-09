const roles = ['admin', 'moderator', 'user', 'guest']

export interface Env {
	USERS_KV: KVNamespace
	SESSIONS_KV: KVNamespace
	DOMAIN: string
}

export interface userObj {
	email: string
	emailVerified: boolean
	username: string
	displayName: string
	password: string
	banned: boolean
	role: string
}

export interface sessionObj {
	username: string
	createdAt: string
	ip: string | null
	userAgent: string | null
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

	const url = new URL(request.url)
	const path = url.pathname
	const paths = path.split('/')

	const { USERS_KV, SESSIONS_KV } = env

	if (!(path.length >= 2) && paths[1] !== version) {
		return new Response(
			'<h1>404 Not Found</h1><p>The requested URL was not found on the server. If you entered the URL manually please check your spelling and try again.</p>',
			{
				status: 404,
				headers: {
					'Content-Type': 'text/html',
				},
			}
		)
	}

	switch (paths[2]) {
		case 'auth': {
			const redirect = url.searchParams.get('redirect')

			switch (paths[3]) {
				case 'login': {
					if (request.method === 'POST') {
						const formData = await request.formData()
						const username = formData.get('username') as string
						const password = formData.get('password') as string

						const user = await USERS_KV.get(username)

						if (!user) {
							return new Response(null, {
								status: 302,
								headers: {
									location: redirect + '?error=invalid-credentials' || `/`,
								},
							})
						}

						const { password: userPassword } = JSON.parse(user)

						if (userPassword !== (await hashPassword(password))) {
							return new Response(null, {
								status: 302,
								headers: {
									location: redirect + '?error=invalid-credentials' || `/`,
								},
							})
						}

						const session = await generateSession(request, username)
						await SESSIONS_KV.put(session.token, session.objectString, {
							expirationTtl: 86400,
						})

						return new Response(null, {
							status: 302,
							headers: {
								Location: redirect || `/`,
								'Set-Cookie': `session=${session}; HttpOnly; Secure; SameSite=Strict; Max-Age=86400; Domain=${env.DOMAIN}; Path=/;`,
							},
						})
					}

					return new Response(
						'<h1>400 Bad Request</h1> <p>The request could not be understood by the server due to malformed syntax. The client SHOULD NOT repeat the request without modifications.</p>',
						{
							status: 400,
							headers: {
								'Content-Type': 'text/html',
							},
						}
					)
				}
				case 'logout': {
					if (request.method === 'POST') {
						const session = await getFromCookie(request, 'session')
						await SESSIONS_KV.delete(session)

						return new Response(null, {
							status: 302,
							headers: {
								location: redirect || `/`,
								'Set-Cookie': `session=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Domain=${env.DOMAIN}; Path=/;`,
							},
						})
					}

					return new Response('Invalid request!', { status: 400 })
				}
				case 'register': {
					if (request.method === 'POST') {
						const formData = await request.formData()

						const email = formData.get('email') as string
						const username = formData.get('username') as string
						const displayName = formData.get('displayName') as string
						const password = formData.get('password') as string

						const user = await USERS_KV.get(username)

						if (user) {
							return new Response('User already exists!', { status: 409 })
						}

						let userObj = {
							email,
							emailVerified: false,
							username,
							displayName,
							password: await hashPassword(password),
							banned: false,
							role: 'user',
						}

						await USERS_KV.put(username, JSON.stringify(userObj))

						const session = await generateSession(request, username)
						await SESSIONS_KV.put(session.token, session.objectString, {
							expirationTtl: 86400,
						})

						return new Response(null, {
							status: 302,
							headers: {
								location: redirect || `/`,
								'Set-Cookie': `session=${session}; HttpOnly; Secure; SameSite=Strict; Max-Age=86400; Domain=${env.DOMAIN}; Path=/;`,
							},
						})
					}
				}
				default:
					return new Response(
						'<h1>404 Not Found</h1><p>The requested URL was not found on the server. If you entered the URL manually please check your spelling and try again.</p>',
						{
							status: 404,
							headers: {
								'Content-Type': 'text/html',
							},
						}
					)
			}
		}

		case 'users': {
			const session = await getFromCookie(request, 'session')
			const sessionObjString = await SESSIONS_KV.get(session)

			if (!sessionObjString) {
				return new Response('<h1>401 Unauthorized</h1>', {
					status: 401,
					headers: {
						'Content-Type': 'text/html',
						'Set-Cookie': `session=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Domain=${env.DOMAIN}; Path=/;`,
					},
				})
			}

			const sessionObj = JSON.parse(sessionObjString) as sessionObj

			const currentUserName = sessionObj.username
			const targetUserName = paths[3]

			if (!currentUserName) {
				return new Response('<h1>404 Not Found</h1>', {
					status: 404,
					headers: {
						'Content-Type': 'text/html',
					},
				})
			}

			const currentUserObjString = await USERS_KV.get(currentUserName)

			if (!currentUserObjString) {
				return new Response('<h1>401 Unauthorized</h1>', {
					status: 401,
					headers: {
						'Content-Type': 'text/html',
						'Set-Cookie': `session=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Domain=${env.DOMAIN}; Path=/;`,
					},
				})
			}

			const currentUserObj = JSON.parse(currentUserObjString) as userObj

			if (paths[3]) {
				switch (request.method) {
					case 'GET': {
						if (!currentUserObj.role.includes('admin')) {
							if (currentUserObj.username !== targetUserName) {
								return new Response(
									'<h1>401 Unauthorized</h1><p>You are not authorized to access this page.</p>',
									{
										status: 401,
										headers: {
											'Content-Type': 'text/html',
										},
									}
								)
							}
						}

						// get target user object
						const targetUserObjString = await USERS_KV.get(targetUserName)

						if (!targetUserObjString) {
							return new Response('<h1>404 Not Found</h1>', {
								status: 404,
								headers: {
									'Content-Type': 'text/html',
								},
							})
						}

						const targetUserObj = JSON.parse(targetUserObjString) as userObj

						const { password, ...rest } = targetUserObj

						return new Response(JSON.stringify(rest), {
							status: 200,
							headers: { 'Content-Type': 'application/json' },
						})
					}
					case 'PUT': {
						if (!currentUserObj.role.includes('admin')) {
							if (currentUserObj.username !== targetUserName) {
								return new Response(
									'<h1>401 Unauthorized</h1><p>You are not authorized to access this page.</p>',
									{
										status: 401,
										headers: {
											'Content-Type': 'text/html',
										},
									}
								)
							}
						}

						const targetUserObjString = await USERS_KV.get(targetUserName)

						if (!targetUserObjString) {
							return new Response('<h1>404 Not Found</h1>', {
								status: 404,
								headers: {
									'Content-Type': 'text/html',
								},
							})
						}

						const targetUserObj = JSON.parse(targetUserObjString) as userObj

						const body = await request.text()
						const update = JSON.parse(body)

						if (update.email) {
							targetUserObj.email = update.email
							targetUserObj.emailVerified = false
						}

						if (update.displayName) {
							targetUserObj.displayName = update.displayName
						}

						if (update.password) {
							targetUserObj.password = update.password
						}

						if (update.banned) {
							if (currentUserObj.role.includes('admin')) {
								targetUserObj.banned = update.banned
							} else {
								return new Response(
									'<h1>401 Unauthorized</h1><p>You are not authorized to access this page.</p>',
									{
										status: 401,
										headers: {
											'Content-Type': 'text/html',
										},
									}
								)
							}
						}

						if (update.role) {
							if (currentUserObj.role.includes('admin')) {
								targetUserObj.role = update.role
							} else {
								return new Response(
									'<h1>401 Unauthorized</h1><p>You are not authorized to access this page.</p>',
									{
										status: 401,
										headers: {
											'Content-Type': 'text/html',
											'Set-Cookie': `session=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Domain=${env.DOMAIN}; Path=/;`,
										},
									}
								)
							}
						}

						await USERS_KV.put(targetUserName, JSON.stringify(targetUserObj))

						return new Response(null, {
							status: 200,
							headers: {
								'Content-Type': 'text/html',
							},
						})
					}
					case 'DELETE': {
						if (!currentUserObj.role.includes('admin')) {
							return new Response(
								'<h1>401 Unauthorized</h1><p>You are not authorized to access this page.</p>',
								{
									status: 401,
									headers: {
										'Content-Type': 'text/html',
									},
								}
							)
						}

						// get target user object
						const targetUserObjString = await USERS_KV.get(targetUserName)

						if (!targetUserObjString) {
							return new Response('<h1>404 Not Found</h1>', {
								status: 404,
								headers: {
									'Content-Type': 'text/html',
								},
							})
						}

						await USERS_KV.delete(targetUserName)

						return new Response(null, { status: 200 })
					}
					default:
						return new Response('<h1>405 Method Not Allowed</h1>', {
							status: 405,
							headers: {
								'Content-Type': 'text/html',
							},
						})
				}
			} else {
				// get current user object
				const currentUserObjString = await USERS_KV.get(currentUserName)

				if (!currentUserObjString) {
					return new Response(
						'<h1>401 Unauthorized</h1><p>You are not authorized to access this page.</p>',
						{
							status: 401,
							headers: {
								'Content-Type': 'text/html',
								'Set-Cookie': `session=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Domain=${env.DOMAIN}; Path=/;`,
							},
						}
					)
				}

				const currentUserObj = JSON.parse(currentUserObjString) as userObj

				if (!currentUserObj.role.includes('admin')) {
					return new Response(
						'<h1>401 Unauthorized</h1><p>You are not authorized to access this page.</p>',
						{
							status: 401,
							headers: {
								'Content-Type': 'text/html',
							},
						}
					)
				}

				switch (request.method) {
					case 'GET':
						const users = await USERS_KV.list()

						if (!users) {
							return new Response(
								'<h1>404 Not Found</h1><p>The requested URL was not found on the server. If you entered the URL manually please check your spelling and try again.</p>',
								{
									status: 404,
									headers: {
										'Content-Type': 'text/html',
									},
								}
							)
						}

						if (users.keys.length === 0) {
							return new Response(
								'<h1>404 Not Found</h1><p>The requested URL was not found on the server. If you entered the URL manually please check your spelling and try again.</p>',
								{
									status: 404,
									headers: {
										'Content-Type': 'text/html',
									},
								}
							)
						}

						const usersArray = []

						for await (const user of users.keys) {
							// get user object
							const userObjString = await USERS_KV.get(user.name)

							if (!userObjString) {
								continue
							}

							// parse user object
							const userObj = JSON.parse(userObjString) as userObj

							// remove password from user object
							const { password, ...rest } = userObj

							usersArray.push(rest)
						}

						return new Response(JSON.stringify(usersArray), {
							status: 200,
							headers: { 'Content-Type': 'application/json' },
						})
					default:
						return new Response('<h1>405 Method Not Allowed</h1>', {
							status: 405,
							headers: {
								'Content-Type': 'text/html',
							},
						})
				}
			}
		}
		default:
			return new Response(
				'<h1>404 Not Found</h1><p>The requested URL was not found on the server. If you entered the URL manually please check your spelling and try again.</p>',
				{
					status: 404,
					headers: {
						'Content-Type': 'text/html',
					},
				}
			)
	}
}

async function getFromCookie(request: Request, name: string): Promise<string> {
	const cookieString = request.headers.get('Cookie')

	if (!cookieString) {
		return ''
	}

	const cookies = cookieString.split(';')
	for (const cookie of cookies) {
		const [key, value] = cookie.split('=')
		if (key.trim() === name) {
			return value
		}
	}

	return ''
}

async function hashPassword(password: string) {
	const encoder = new TextEncoder()
	const data = encoder.encode(password)
	const hash = await crypto.subtle.digest('SHA-256', data)
	return btoa(String.fromCharCode(...new Uint8Array(hash)))
}

async function generateSession(request: Request, username: string) {
	const token = crypto.randomUUID()
	const object: sessionObj = {
		username,
		createdAt: new Date().toISOString(),
		ip: request.headers.get('CF-Connecting-IP'),
		userAgent: request.headers.get('User-Agent'),
	}

	return {
		token,
		object,
		objectString: JSON.stringify(object),
	}
}
