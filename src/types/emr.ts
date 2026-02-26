

export type UserRole = 'admin' | 'room';

export interface User {
    id: string;
    role: UserRole;
    name: string;
    email?: string;
    roomId?: string;
}

export interface Room {
    id: string;
    name: string;
    floor?: string;
    status: 'free' | 'occupied' | 'offline';
    currentPatientId?: string;
    assignedDoctorId?: string;
    assignedDoctor?: Doctor;
    devicePin: string;
}

export interface Doctor {
    id: string;
    name: string;
    title: string;
    specialty: string;
    email?: string;
    phone?: string;
    avatarUrl?: string;
}

export interface Patient {
    id: string;
    mrn: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    gender: 'male' | 'female' | 'other' | 'undisclosed';
    phone?: string;
    email?: string;
    address?: string;
    insuranceProvider?: string;
    primaryPhysicianId?: string;
    allergies?: string[];
    conditions?: string[];
}

export interface Appointment {
    id: string;
    patientId: string;
    doctorId: string;
    roomId: string;
    scheduledTime: string;
    duration: number;
    status: 'scheduled' | 'checked-in' | 'in-progress' | 'completed' | 'cancelled';
    reason?: string;
    notes?: string;
}

export interface Visit {
    id: string;
    appointmentId?: string;
    patientId: string;
    doctorId: string;
    roomId: string;
    startTime: string;
    endTime?: string;
    status: 'recording' | 'draft' | 'pending-review' | 'approved';
    transcript?: string;
    summary?: {
        chiefComplaint?: string;
        issuesIdentified: string[];
        actionsPlan: string[];
        prescriptions?: string[];
        followUp?: string;
    };
}


export interface AuthCredentials {
    mode: 'admin' | 'room';
    // For admin login
    email?: string;
    password?: string;
    // For room login
    roomId?: string;
    pin?: string;
}

export interface AuthState {
    isAuthenticated: boolean;
    user: User | null;
    room: Room | null;
    loading: boolean;
    error: string | null;
}
