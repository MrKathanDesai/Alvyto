import { Patient, MedicalHistory, Visit } from '@/types';
import { Room, Doctor } from '@/types/emr';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api';

class ApiService {
    private async fetchWithTimeout(url: string, options: RequestInit = {}, timeout = 5000): Promise<Response> {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
            const { headers = {}, ...rest } = options;
            const response = await fetch(url, {
                ...rest,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0',
                    ...headers,
                },
                signal: controller.signal,
                cache: 'no-store'
            });
            clearTimeout(id);
            return response;
        } catch (error) {
            clearTimeout(id);
            throw error;
        }
    }

    async login(credentials: any): Promise<any> {
        const response = await this.fetchWithTimeout(`${API_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(credentials)
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Login failed');
        }
        return response.json();
    }

    async getPatients(): Promise<Patient[]> {
        const response = await this.fetchWithTimeout(`${API_BASE_URL}/patients`);
        if (!response.ok) throw new Error('Failed to fetch patients');
        const data = await response.json();
        return data.map((p: any) => ({
            id: p.id,
            name: p.name,
            age: this.calculateAge(p.date_of_birth),
            sex: p.gender,
            patientId: p.mrn,
            createdAt: p.created_at
        }));
    }

    async getPatient(id: string): Promise<Patient> {
        const response = await this.fetchWithTimeout(`${API_BASE_URL}/patients/${id}`);
        if (!response.ok) throw new Error('Failed to fetch patient');
        const p = await response.json();
        return {
            id: p.id,
            name: p.name,
            age: this.calculateAge(p.date_of_birth),
            sex: p.gender,
            patientId: p.mrn,
            createdAt: p.created_at
        };
    }

    async updatePatient(id: string, updates: Partial<Patient>): Promise<Patient> {
        const payload: any = {};
        if (updates.name) payload.name = updates.name;
        if (updates.patientId) payload.mrn = updates.patientId;
        if (updates.sex) payload.gender = updates.sex;

        const response = await this.fetchWithTimeout(`${API_BASE_URL}/patients/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error('Failed to update patient');
        const p = await response.json();
        return {
            id: p.id,
            name: p.name,
            age: this.calculateAge(p.date_of_birth),
            sex: p.gender,
            patientId: p.mrn,
            createdAt: p.created_at
        };
    }

    async createPatient(patient: Partial<Patient> & { dateOfBirth: string }): Promise<Patient> {
        const payload = {
            name: patient.name,
            mrn: patient.patientId,
            date_of_birth: patient.dateOfBirth,
            gender: patient.sex
        };

        const response = await this.fetchWithTimeout(`${API_BASE_URL}/patients`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error('Failed to create patient');
        const p = await response.json();
        return {
            id: p.id,
            name: p.name,
            age: this.calculateAge(p.date_of_birth),
            sex: p.gender,
            patientId: p.mrn,
            createdAt: p.created_at
        };
    }

    async getMedicalHistory(patientId: string): Promise<MedicalHistory> {
        const response = await this.fetchWithTimeout(`${API_BASE_URL}/patients/${patientId}`);
        if (!response.ok) throw new Error('Failed to fetch medical history');
        const p = await response.json();

        if (!p.medical_history) return null as any;

        return {
            id: p.medical_history.id || 'temp',
            patientId: p.id,
            conditions: p.medical_history.conditions || [],
            allergies: p.medical_history.allergies || [],
            medications: p.medical_history.medications || [],
            updatedAt: p.medical_history.updated_at || new Date().toISOString()
        };
    }

    async getRooms(): Promise<Room[]> {
        const response = await this.fetchWithTimeout(`${API_BASE_URL}/rooms`);
        if (!response.ok) throw new Error('Failed to fetch rooms');
        const data = await response.json();
        return data.map((r: any) => ({
            id: r.id,
            name: r.name,
            floor: r.floor,
            status: r.status,
            devicePin: r.device_pin,
            currentPatientId: r.current_patient_id,
            assignedDoctorId: r.assigned_doctor_id,
            assignedDoctor: r.assigned_doctor ? {
                id: r.assigned_doctor.id,
                name: r.assigned_doctor.name,
                title: r.assigned_doctor.name.startsWith('Dr.') ? 'MD' : 'NP',
                specialty: r.assigned_doctor.specialty,
                email: r.assigned_doctor.email
            } : undefined
        }));
    }

    async createRoom(room: Partial<Room>): Promise<Room> {
        const payload = {
            name: room.name,
            floor: room.floor,
            device_pin: room.devicePin,
            status: room.status || 'free'
        };
        const response = await this.fetchWithTimeout(`${API_BASE_URL}/rooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('Failed to create room');
        const r = await response.json();
        return {
            id: r.id,
            name: r.name,
            floor: r.floor,
            status: r.status,
            devicePin: r.device_pin,
            currentPatientId: r.current_patient_id,
            assignedDoctorId: r.assigned_doctor_id,
            assignedDoctor: r.assigned_doctor ? {
                id: r.assigned_doctor.id,
                name: r.assigned_doctor.name,
                title: r.assigned_doctor.name.startsWith('Dr.') ? 'MD' : 'NP',
                specialty: r.assigned_doctor.specialty,
                email: r.assigned_doctor.email
            } : undefined
        };
    }

    async updateRoom(roomId: string, updates: Partial<Room>): Promise<Room> {
        // Map frontend camelCase to backend snake_case
        const payload: any = {};
        if (updates.status) payload.status = updates.status;
        if (updates.currentPatientId !== undefined) payload.current_patient_id = updates.currentPatientId; // Allow null to clear
        if (updates.assignedDoctorId !== undefined) payload.assigned_doctor_id = updates.assignedDoctorId;

        const response = await this.fetchWithTimeout(`${API_BASE_URL}/rooms/${roomId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('Failed to update room');
        const r = await response.json();
        return {
            id: r.id,
            name: r.name,
            floor: r.floor,
            status: r.status,
            devicePin: r.device_pin,
            currentPatientId: r.current_patient_id,
            assignedDoctorId: r.assigned_doctor_id,
            assignedDoctor: r.assigned_doctor ? {
                id: r.assigned_doctor.id,
                name: r.assigned_doctor.name,
                title: r.assigned_doctor.name.startsWith('Dr.') ? 'MD' : 'NP',
                specialty: r.assigned_doctor.specialty,
                email: r.assigned_doctor.email
            } : undefined
        };
    }

    async deleteRoom(roomId: string): Promise<void> {
        const response = await this.fetchWithTimeout(`${API_BASE_URL}/rooms/${roomId}`, {
            method: 'DELETE',
        });
        if (!response.ok && response.status !== 204) throw new Error('Failed to delete room');
    }

    async getDoctors(): Promise<Doctor[]> {
        const response = await this.fetchWithTimeout(`${API_BASE_URL}/doctors`);
        if (!response.ok) throw new Error('Failed to fetch doctors');
        const data = await response.json();
        return data.map((d: any) => ({
            id: d.id,
            name: d.name,
            title: d.name.startsWith('Dr.') ? 'MD' : 'NP',
            specialty: d.specialty,
            email: d.email
        }));
    }

    async createVisit(visit: Partial<Visit> & { doctorId?: string; roomId?: string }): Promise<Visit> {
        const payload = {
            patient_id: visit.patientId,
            doctor_id: visit.doctorId || 'd1',
            room_id: visit.roomId || 'room1',
            status: visit.status || 'scheduled'
        };
        const response = await this.fetchWithTimeout(`${API_BASE_URL}/visits`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('Failed to create visit');
        return this.mapVisit(await response.json());
    }

    async updateVisit(visitId: string, updates: Partial<Visit>): Promise<Visit> {
        const payload: any = {};
        if (updates.transcript) payload.transcript = updates.transcript;
        if (updates.status) payload.status = updates.status;
        if (updates.summary) payload.summary = updates.summary;

        const response = await this.fetchWithTimeout(`${API_BASE_URL}/visits/${visitId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('Failed to update visit');
        return this.mapVisit(await response.json());
    }

    async getVisits(filters: { roomId?: string; status?: string }): Promise<Visit[]> {
        const params = new URLSearchParams();
        if (filters.roomId) params.append('room_id', filters.roomId);
        if (filters.status) params.append('status', filters.status);

        const response = await this.fetchWithTimeout(`${API_BASE_URL}/visits?${params.toString()}`);
        if (!response.ok) throw new Error('Failed to fetch visits');
        const data = await response.json();
        return data.map((v: any) => this.mapVisit(v));
    }

    async getPatientVisits(patientId: string): Promise<Visit[]> {
        const response = await this.fetchWithTimeout(`${API_BASE_URL}/patients/${patientId}/visits`);
        if (!response.ok) throw new Error('Failed to fetch visits');
        const data = await response.json();
        return data.map((v: any) => this.mapVisit(v));
    }

    private mapVisit(v: any): Visit {
        return {
            id: v.id,
            patientId: v.patient_id,
            transcript: v.transcript || '',
            atomicFacts: [],
            summary: v.summary || { issuesIdentified: [], actionsPlan: [] },
            status: v.status,
            createdAt: v.created_at,
            approvedAt: v.ended_at
        };
    }

    private calculateAge(dob: string): number {
        const birthDate = new Date(dob);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        return age;
    }
}

export const api = new ApiService();
