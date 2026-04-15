import { useState, useEffect, useCallback } from 'react';
import { getQueue } from '@/services/api';
import { QueueEntry } from '@/types/emr';

export function useRoomQueue(roomId: string | undefined) {
    const [queue, setQueue] = useState<QueueEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchQueue = useCallback(async () => {
        if (!roomId) return;
        setLoading(true);
        setError(null);
        try {
            const summary = await getQueue();
            const roomEntries = summary.entries
                .filter((e) => e.roomId === roomId && (e.status === 'waiting' || e.status === 'called'))
                .sort((a, b) => {
                    if (a.priority !== b.priority) return a.priority - b.priority;
                    return new Date(a.checkInTime).getTime() - new Date(b.checkInTime).getTime();
                });
            setQueue(roomEntries);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to load queue';
            console.error('Failed to fetch room queue:', err);
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, [roomId]);

    useEffect(() => {
        void fetchQueue();
        const interval = setInterval(() => {
            void fetchQueue();
        }, 15000);
        return () => clearInterval(interval);
    }, [fetchQueue]);

    return { queue, loading, error, refreshQueue: fetchQueue };
}
