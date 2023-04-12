export interface Index {
	meta: any
	updated: string
}

export async function get(
	INDEXES: any,
	indexId: string,
	id: string,
	idName: string
) {
	const index = await INDEXES.get(indexId).then((data: any) => JSON.parse(data))
	return index.meta.find((meta: any) => meta[idName] === id)
}

export async function getAll(INDEXES: any, indexId: string) {
	return await INDEXES.get(indexId).then((data: any) => JSON.parse(data))
}

export async function set(
	INDEXES: any,
	indexId: string,
	id: string,
	idName: string,
	metadata: any
) {
	const index = await INDEXES.get(indexId).then((data: any) => JSON.parse(data))

	const existing = index.meta.find((meta: any) => meta[idName] === id)
	if (existing) {
		index.meta = index.meta.filter((meta: any) => meta[idName] !== id)
	}

	index.meta.push({ ...metadata, [idName]: id })

	index.updated = new Date().toISOString()
	await INDEXES.put(indexId, JSON.stringify(index))
}

export async function remove(
	INDEXES: any,
	indexId: string,
	id: string,
	idName: string
) {
	const index = await INDEXES.get(indexId).then((data: any) => JSON.parse(data))
	index.meta = index.meta.filter((meta: any) => meta[idName] !== id)
	index.updated = new Date().toISOString()
	await INDEXES.put(indexId, JSON.stringify(index))
}

export default {
	get,
	getAll,
	set,
	remove,
}
