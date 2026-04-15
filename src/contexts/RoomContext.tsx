'use client';

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Room } from '@/types/emr';
import { useAuth } from '@/contexts/AuthContext';
import {
    getRooms,
    createRoom as createRoomApi,
    deleteRoom as deleteRoomApi,
    updateRoom as updateRoomApi,
} from '@/services/api';

interface CreateRoomInput {
    name: string;
    floor?: string | number | null;
    device_pin: string;
}

interface RoomContextType {
    rooms: Room[];
    getRoom: (id: string) => Room | undefined;
    createRoom: (room: CreateRoomInput) => Promise<void>;
    deleteRoom: (roomId: string) => Promise<void>;
    updateRoom: (roomId: string, updates: Partial<Room>) => Promise<void>;
    assignPatient: (roomId: string, patientId: string) => Promise<void>;
    dischargePatient: (roomId: string) => Promise<void>;
    assignDoctor: (roomId: string, doctorId: string) => Promise<void>;
    unassignDoctor: (roomId: string) => Promise<void>;
    refreshRooms: () => Promise<void>;
    loading: boolean;
    loaded: boolean;
}

const RoomContext = createContext<RoomContextType | null>(null);

export function RoomProvider({ children }: { children: ReactNode }) {
    const [rooms, setRooms] = useState<Room[]>([]);
    const [loading, setLoading] = useState(true);
    const [loaded, setLoaded] = useState(false);
    const auth = useAuth();

    const refreshRooms = useCallback(async () => {
        setLoading(true);

        try {
            const data = await getRooms();

            setRooms((prev) => {
                // Keep existing rooms during background refreshes to avoid empty flashes.
                if (loaded && data.length === 0 && prev.length > 0) {
                    return prev;
                }

                // On first load we always set what we got (including empty list).
                if (!loaded) {
                    return data;
                }

                // After first load, only replace when API actually returns data.
                return data.length > 0 ? data : prev;
            });

            // Mark initial load complete after first successful fetch.
            if (!loaded) {
                setLoaded(true);
            }
        } catch (error) {
            console.error('Failed to fetch rooms:', error);
            // Only throw on initial load; on background refreshes, swallow error
            if (!loaded) {
                throw error;
            }
        } finally {
            setLoading(false);
        }
    }, [loaded]);

    useEffect(() => {
        // Only start fetching rooms once auth has loaded and user is authenticated
        if (!auth.loaded) return;
        if (!auth.isAuthenticated) {
            setLoaded(true); // Mark as loaded even if not authenticated
            setLoading(false);
            return;
        }

        void refreshRooms();
    }, [auth.loaded, auth.isAuthenticated, refreshRooms]);

    // Poll for room updates every 10 seconds to stay in sync with admin actions
    useEffect(() => {
        if (!auth.isAuthenticated || !loaded) return;
        const interval = setInterval(() => {
            void refreshRooms();
        }, 10000);
        return () => clearInterval(interval);
    }, [auth.isAuthenticated, loaded, refreshRooms]);

    const getRoom = useCallback((id: string) => {
        return rooms.find((r) => r.id === id);
    }, [rooms]);
    const createRoom = useCallback(async (room: CreateRoomInput) => {
        try {
            const newRoom = await createRoomApi({
                name: room.name,
                floor: room.floor === null || room.floor === undefined ? undefined : String(room.floor),
                devicePin: room.device_pin,
            });
            setRooms((prev) => [...prev, newRoom]);
        } catch (error) {
            console.error('Failed to create room:', error);
            throw error;
        }
    }, []);

    const deleteRoom = useCallback(async (roomId: string) => {
        try {
            await deleteRoomApi(roomId);
            setRooms((prev) => prev.filter((room) => room.id !== roomId));
        } catch (error) {
            console.error('Failed to delete room:', error);
            throw error;
        }
    }, []);

    const updateRoom = useCallback(async (roomId: string, updates: Partial<Room>) => {
        try {
            const normalizedUpdates = {
                ...updates,
                floor: updates.floor ?? undefined,
            };

            const updatedRoom = await updateRoomApi(roomId, {
                name: normalizedUpdates.name,
                floor: normalizedUpdates.floor,
                roomAgentPort: normalizedUpdates.roomAgentPort ?? undefined,
                status: normalizedUpdates.status,
                currentPatientId: normalizedUpdates.currentPatientId === undefined ? undefined : normalizedUpdates.currentPatientId,
                assignedDoctorId: normalizedUpdates.assignedDoctorId === undefined ? undefined : normalizedUpdates.assignedDoctorId,
            });
            setRooms((prev) => prev.map((room) => (room.id === roomId ? updatedRoom : room)));
        } catch (error) {
            console.error('Failed to update room:', error);
            throw error;
        }
    }, []);

    const assignPatient = useCallback(async (roomId: string, patientId: string) => {
        const updatedRoom = await updateRoomApi(roomId, {
            currentPatientId: patientId,
            status: 'in_use',
        });
        setRooms((prev) => prev.map((room) => (room.id === roomId ? updatedRoom : room)));
    }, []);

    const dischargePatient = useCallback(async (roomId: string) => {
        const updatedRoom = await updateRoomApi(roomId, {
            currentPatientId: null,
            assignedDoctorId: null,
            status: 'idle',
        });
        setRooms((prev) => prev.map((room) => (room.id === roomId ? updatedRoom : room)));
    }, []);

    const assignDoctor = useCallback(async (roomId: string, doctorId: string) => {
        const updatedRoom = await updateRoomApi(roomId, {
            assignedDoctorId: doctorId,
            status: 'in_use',
        });
        setRooms((prev) => prev.map((room) => (room.id === roomId ? updatedRoom : room)));
    }, []);

    const unassignDoctor = useCallback(async (roomId: string) => {
        const updatedRoom = await updateRoomApi(roomId, {
            assignedDoctorId: null,
        });
        setRooms((prev) => prev.map((room) => (room.id === roomId ? updatedRoom : room)));
    }, []);

    return (
        <RoomContext.Provider value={{
            rooms,
            getRoom,
            createRoom,
            deleteRoom,
            updateRoom,
            assignPatient,
            dischargePatient,
            assignDoctor,
            unassignDoctor,
            refreshRooms,
            loading,
            loaded,
        }}>
            {children}
        </RoomContext.Provider>
    );
}

export function useRooms() {
    const context = useContext(RoomContext);
    if (!context) {
        throw new Error('useRooms must be used within a RoomProvider');
    }
    return context;
}

