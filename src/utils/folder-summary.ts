// Lightweight summary (child count + a few thumbnails) of a browsable folder.
//  - memory + localStorage cache, so the second visit renders instantly
//  - each folder is re-validated once per page load (stale-while-revalidate)
//  - callWS requests are limited in parallelism so the integration isn't flooded
export interface FolderSummary {
    count: number;
    thumbs: string[];
}

const STORAGE_KEY = "polr-ytube-folder-summary-v1";
const MAX_THUMBS = 4;
const MAX_PARALLEL = 4;

const summaries = new Map<string, FolderSummary>();
const revalidated = new Map<string, Promise<FolderSummary | undefined>>();

try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    for (const [key, value] of Object.entries(stored))
        summaries.set(key, value as FolderSummary);
} catch (e) {
    // ignore corrupt cache
}

function persist() {
    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(
                [...summaries.entries()].reduce((o, [k, v]) => {
                    o[k] = v;
                    return o;
                }, {} as Record<string, FolderSummary>)
            )
        );
    } catch (e) {
        // storage full / unavailable - memory cache still works
    }
}

let active = 0;
const waiting: (() => void)[] = [];

async function limited<T>(task: () => Promise<T>): Promise<T> {
    if (active >= MAX_PARALLEL)
        await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
        return await task();
    } finally {
        active--;
        waiting.shift()?.();
    }
}

const makeKey = (entityId: string, type: string, id: string) =>
    `${entityId}|${type}|${id}`;

export function peekSummary(
    entityId: string,
    type: string,
    id: string
): FolderSummary | undefined {
    return summaries.get(makeKey(entityId, type, id));
}

async function fetchSummary(
    hass: any,
    entityId: string,
    type: string,
    id: string,
    depth: number
): Promise<FolderSummary> {
    const response: any = await limited(() =>
        hass.callWS({
            type: "media_player/browse_media",
            entity_id: entityId,
            media_content_type: type,
            media_content_id: id,
        })
    );
    const children: any[] = response?.children ?? [];
    let thumbs = [
        ...new Set(children.map((c) => c.thumbnail).filter((t) => !!t)),
    ].slice(0, MAX_THUMBS) as string[];

    // Children without artwork (e.g. shelves on "Home"): look one level deeper.
    if (thumbs.length == 0 && depth > 0) {
        const nested = await Promise.all(
            children
                .filter((c) => c.can_expand)
                .slice(0, 3)
                .map((c) =>
                    fetchSummary(
                        hass,
                        entityId,
                        c.media_content_type,
                        c.media_content_id,
                        depth - 1
                    ).catch(() => undefined)
                )
        );
        thumbs = nested.find((n) => n && n.thumbs.length > 0)?.thumbs ?? [];
    }

    return { count: children.length, thumbs };
}

export function getSummary(
    hass: any,
    entityId: string,
    type: string,
    id: string
): Promise<FolderSummary | undefined> {
    const key = makeKey(entityId, type, id);
    let pending = revalidated.get(key);
    if (!pending) {
        pending = fetchSummary(hass, entityId, type, id, 1)
            .then((summary) => {
                summaries.set(key, summary);
                persist();
                return summary;
            })
            .catch((e) => {
                console.warn("Unable to summarise folder", type, id, e);
                revalidated.delete(key); // allow a retry later
                return summaries.get(key);
            });
        revalidated.set(key, pending);
    }
    return pending;
}
