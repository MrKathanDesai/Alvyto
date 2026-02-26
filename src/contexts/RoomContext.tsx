'use client';

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Room } from '@/types/emr';
import { api } from '@/services/api';

interface RoomContextType {
    rooms: Room[];
    getRoom: (id: string) => Room | undefined;
    createRoom: (room: Partial<Room>) => Promise<void>;
    deleteRoom: (roomId: string) => Promise<void>;
    updateRoom: (roomId: string, updates: Partial<Room>) => Promise<void>;
    assignPatient: (roomId: string, patientId: string) => Promise<void>;
    dischargePatient: (roomId: string) => Promise<void>;
    assignDoctor: (roomId: string, doctorId: string) => Promise<void>;
    unassignDoctor: (roomId: string) => Promise<void>;
    refreshRooms: () => Promise<void>;
    loading: boolean;
}

const RoomContext = createContext<RoomContextType | null>(null);

export function RoomProvider({ children }: { children: ReactNode }) {
    const [rooms, setRooms] = useState<Room[]>([]);
    const [loading, setLoading] = useState(true);

    const refreshRooms = useCallback(async () => {
        try {
            const data = await api.getRooms();
            setRooms(data);
        } catch (error) {
            console.error('Failed to fetch rooms:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refreshRooms();
    }, [refreshRooms]);

    const getRoom = useCallback((id: string) => {
        return rooms.find(r => r.id === id);
    }, [rooms]);

    const createRoom = useCallback(async (room: Partial<Room>) => {
        try {
            const newRoom = await api.createRoom(room);
            setRooms(prev => [...prev, newRoom]);
        } catch (error) {
            console.error('Failed to create room:', error);
            throw error;
        }
    }, []);

    const deleteRoom = useCallback(async (roomId: string) => {
        try {
            setRooms(prev => prev.filter(room => room.id !== roomId));
            await api.deleteRoom(roomId);
        } catch (error) {
            console.error('Failed to delete room:', error);
            refreshRooms();
            throw error;
        }
    }, [refreshRooms]);

    const updateRoom = useCallback(async (roomId: string, updates: Partial<Room>) => {
        try {
            setRooms(prev => prev.map(room =>
                room.id === roomId ? { ...room, ...updates } : room
            ));

            const updatedRoom = await api.updateRoom(roomId, updates);
            setRooms(prev => prev.map(room =>
                room.id === roomId ? updatedRoom : room
            ));
        } catch (error) {
            console.error('Failed to update room:', error);
            refreshRooms();
        }
    }, [refreshRooms]);

    const assignPatient = useCallback(async (roomId: string, patientId: string) => {
        await updateRoom(roomId, {
            currentPatientId: patientId,
            status: 'occupied'
        });
    }, [updateRoom, refreshRooms]);

    const dischargePatient = useCallback(async (roomId: string) => {
        await updateRoom(roomId, {
            currentPatientId: undefined,
            status: 'free'
        });
    }, [updateRoom]);

    const assignDoctor = useCallback(async (roomId: string, doctorId: string) => {
        await updateRoom(roomId, { assignedDoctorId: doctorId });
    }, [updateRoom]);

    const unassignDoctor = useCallback(async (roomId: string) => {
        await updateRoom(roomId, { assignedDoctorId: undefined });
    }, [updateRoom]);

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
            loading
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
