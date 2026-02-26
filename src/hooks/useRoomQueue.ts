import { useState, useEffect, useCallback } from 'react';
import { api } from '@/services/api';
import { Visit } from '@/types';

export function useRoomQueue(roomId: string | undefined) {
    const [queue, setQueue] = useState<Visit[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchQueue = useCallback(async () => {
        if (!roomId) return;

        setLoading(true);
        setError(null);
        try {
            const visits = await api.getVisits({ roomId, status: 'scheduled' });
            setQueue(visits);
        } catch (err: any) {
            console.error('Failed to fetch room queue:', err);
            setError(err.message || 'Failed to load queue');
        } finally {
            setLoading(false);
        }
    }, [roomId]);

    useEffect(() => {
        fetchQueue();

        const interval = setInterval(fetchQueue, 30000);
        return () => clearInterval(interval);
    }, [fetchQueue]);

    return { queue, loading, error, refreshQueue: fetchQueue };
}
