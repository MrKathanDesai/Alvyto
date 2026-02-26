'use client';

import { useState, useEffect } from 'react';
import { useRooms } from '@/contexts/RoomContext';
import { api } from '@/services/api';
import { Room, Doctor } from '@/types/emr';
import { Patient } from '@/types';
import styles from './page.module.css';

export default function RoomsPage() {
    const { rooms, assignPatient, assignDoctor, dischargePatient, unassignDoctor, createRoom, deleteRoom } = useRooms();
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<string>('all');

    // Data State
    const [patients, setPatients] = useState<Patient[]>([]);
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [patientsMap, setPatientsMap] = useState<Record<string, Patient>>({});
    const [doctorsMap, setDoctorsMap] = useState<Record<string, Doctor>>({});
    const [loading, setLoading] = useState(true);

    // Edit Modal state
    const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
    const [selectedPatientId, setSelectedPatientId] = useState<string>('');

    // Create Modal state
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [newRoomData, setNewRoomData] = useState({
        name: '',
        floor: '1',
        devicePin: ''
    });

    // Delete confirmation state
    const [roomToDelete, setRoomToDelete] = useState<Room | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // Load Data
    useEffect(() => {
        async function loadData() {
            try {
                const [patientsData, doctorsData] = await Promise.all([
                    api.getPatients(),
                    api.getDoctors()
                ]);

                setPatients(patientsData);
                setDoctors(doctorsData);

                // Index by ID for quick lookup
                setPatientsMap(patientsData.reduce((acc, p) => {
                    acc[p.id] = p;
                    return acc;
                }, {} as Record<string, Patient>));

                setDoctorsMap(doctorsData.reduce((acc, d) => {
                    acc[d.id] = d;
                    return acc;
                }, {} as Record<string, Doctor>));

            } catch (error) {
                console.error("Failed to load room management data", error);
            } finally {
                setLoading(false);
            }
        }
        loadData();
    }, []);

    // Filter rooms
    const filteredRooms = rooms.filter(room => {
        const matchesSearch = room.name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = filterStatus === 'all' || room.status === filterStatus;
        return matchesSearch && matchesStatus;
    });

    const handleEditClick = (room: Room) => {
        setSelectedRoom(room);
        setSelectedDoctorId(room.assignedDoctorId || '');
        setSelectedPatientId(room.currentPatientId || '');
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        if (!selectedRoom) return;

        // Update Doctor
        if (selectedDoctorId && selectedDoctorId !== selectedRoom.assignedDoctorId) {
            await assignDoctor(selectedRoom.id, selectedDoctorId);
        } else if (!selectedDoctorId && selectedRoom.assignedDoctorId) {
            await unassignDoctor(selectedRoom.id);
        }

        // Update Patient
        if (selectedPatientId && selectedPatientId !== selectedRoom.currentPatientId) {
            await assignPatient(selectedRoom.id, selectedPatientId);
        } else if (!selectedPatientId && selectedRoom.currentPatientId) {
            await dischargePatient(selectedRoom.id);
        }

        setIsModalOpen(false);
        setSelectedRoom(null);
    };

    const handleCreateRoom = async () => {
        if (!newRoomData.name || !newRoomData.devicePin) {
            alert("Please fill in all required fields");
            return;
        }

        try {
            await createRoom({
                name: newRoomData.name,
                floor: newRoomData.floor,
                devicePin: newRoomData.devicePin,
                status: 'free'
            });
            setIsCreateModalOpen(false);
            setNewRoomData({ name: '', floor: '1', devicePin: '' });
        } catch (error) {
            console.error("Failed to create room", error);
            alert("Failed to create room. Please try again.");
        }
    };

    const handleDeleteRoom = (room: Room) => {
        if (room.currentPatientId) {
            alert(`Cannot delete ${room.name} — a patient is currently assigned. Discharge the patient first.`);
            return;
        }
        setRoomToDelete(room);
    };

    const confirmDelete = async () => {
        if (!roomToDelete) return;
        setIsDeleting(true);
        try {
            await deleteRoom(roomToDelete.id);
        } catch (error) {
            console.error("Failed to delete room", error);
            alert("Failed to delete room. Please try again.");
        } finally {
            setIsDeleting(false);
            setRoomToDelete(null);
        }
    };

    if (loading) {
        return <div className={styles.loading}>Loading...</div>;
    }

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div>
                    <h1 className={styles.title}>Room Management</h1>
                    <p className={styles.subtitle}>Manage exam rooms and assignments</p>
                </div>
                <button className={styles.addButton} onClick={() => setIsCreateModalOpen(true)}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 5v14M5 12h14" />
                    </svg>
                    Add Room
                </button>
            </header>

            {/* Filters */}
            <div className={styles.filters}>
                <div className={styles.searchBox}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.searchIcon}>
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                        type="text"
                        placeholder="Search rooms..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className={styles.searchInput}
                    />
                </div>

                <div className={styles.filterGroup}>
                    <button
                        className={`${styles.filterButton} ${filterStatus === 'all' ? styles.active : ''}`}
                        onClick={() => setFilterStatus('all')}
                    >
                        All
                    </button>
                    <button
                        className={`${styles.filterButton} ${filterStatus === 'free' ? styles.active : ''}`}
                        onClick={() => setFilterStatus('free')}
                    >
                        Available
                    </button>
                    <button
                        className={`${styles.filterButton} ${filterStatus === 'occupied' ? styles.active : ''}`}
                        onClick={() => setFilterStatus('occupied')}
                    >
                        Occupied
                    </button>
                    <button
                        className={`${styles.filterButton} ${filterStatus === 'offline' ? styles.active : ''}`}
                        onClick={() => setFilterStatus('offline')}
                    >
                        Offline
                    </button>
                </div>
            </div>

            {/* Rooms Table */}
            <div className={styles.tableContainer}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>Room Name</th>
                            <th>Status</th>
                            <th>Assigned Doctor</th>
                            <th>Current Patient</th>
                            <th>Device PIN</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredRooms.map(room => {
                            const patient = room.currentPatientId ? patientsMap[room.currentPatientId] : null;
                            const doctor = room.assignedDoctorId ? doctorsMap[room.assignedDoctorId] : null;

                            return (
                                <tr key={room.id}>
                                    <td>
                                        <div className={styles.roomInfo}>
                                            <span className={styles.roomName}>{room.name}</span>
                                            <span className={styles.roomFloor}>{room.floor}</span>
                                        </div>
                                    </td>
                                    <td>
                                        <span className={`${styles.statusBadge} ${styles[room.status]}`}>
                                            {room.status}
                                        </span>
                                    </td>
                                    <td>
                                        {doctor ? (
                                            <div className={styles.personInfo}>
                                                <div className={styles.avatar}>{doctor.name.charAt(0)}</div>
                                                <span>{doctor.name}</span>
                                            </div>
                                        ) : (
                                            <span className={styles.unassigned}>Unassigned</span>
                                        )}
                                    </td>
                                    <td>
                                        {patient ? (
                                            <div className={styles.personInfo}>
                                                <div className={`${styles.avatar} ${styles.patient}`}>{patient.name.charAt(0)}</div>
                                                <span>{patient.name}</span>
                                            </div>
                                        ) : (
                                            <span className={styles.empty}>Empty</span>
                                        )}
                                    </td>
                                    <td>
                                        <code className={styles.pin}>{room.devicePin}</code>
                                    </td>
                                    <td>
                                        <div className={styles.actionGroup}>
                                            <button
                                                className={styles.actionButton}
                                                onClick={() => handleEditClick(room)}
                                            >
                                                Manage
                                            </button>
                                            <button
                                                className={`${styles.actionButton} ${styles.deleteButton}`}
                                                onClick={() => handleDeleteRoom(room)}
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Edit Modal */}
            {isModalOpen && selectedRoom && (
                <div className={styles.modalOverlay}>
                    <div className={styles.modal}>
                        <div className={styles.modalHeader}>
                            <h2 className={styles.modalTitle}>Manage {selectedRoom.name}</h2>
                            <button className={styles.closeButton} onClick={() => setIsModalOpen(false)}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M18 6L6 18M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className={styles.modalBody}>
                            <div className={styles.field}>
                                <label className={styles.label}>Assigned Doctor</label>
                                <select
                                    className={styles.select}
                                    value={selectedDoctorId}
                                    onChange={(e) => setSelectedDoctorId(e.target.value)}
                                >
                                    <option value="">-- Unassigned --</option>
                                    {doctors.map(doc => (
                                        <option key={doc.id} value={doc.id}>
                                            {doc.name} ({doc.specialty})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className={styles.field}>
                                <label className={styles.label}>Current Patient</label>
                                <select
                                    className={styles.select}
                                    value={selectedPatientId}
                                    onChange={(e) => setSelectedPatientId(e.target.value)}
                                >
                                    <option value="">-- No Patient --</option>
                                    {patients.map(p => (
                                        <option key={p.id} value={p.id}>
                                            {p.name} (Age: {p.age})
                                        </option>
                                    ))}
                                </select>
                                <p className={styles.hint}>
                                    Assigning a patient will mark the room as Occupied.
                                    Removing a patient will mark the room as Free.
                                </p>
                            </div>
                        </div>

                        <div className={styles.modalFooter}>
                            <button className={styles.cancelButton} onClick={() => setIsModalOpen(false)}>Cancel</button>
                            <button className={styles.saveButton} onClick={handleSave}>Save Changes</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Create Modal */}
            {isCreateModalOpen && (
                <div className={styles.modalOverlay}>
                    <div className={styles.modal}>
                        <div className={styles.modalHeader}>
                            <h2 className={styles.modalTitle}>Add New Room</h2>
                            <button className={styles.closeButton} onClick={() => setIsCreateModalOpen(false)}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M18 6L6 18M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className={styles.modalBody}>
                            <div className={styles.field}>
                                <label className={styles.label}>Room Name *</label>
                                <input
                                    type="text"
                                    className={styles.input}
                                    placeholder="e.g. Exam Room 3"
                                    value={newRoomData.name}
                                    onChange={(e) => setNewRoomData({ ...newRoomData, name: e.target.value })}
                                />
                            </div>

                            <div className={styles.field}>
                                <label className={styles.label}>Floor</label>
                                <select
                                    className={styles.select}
                                    value={newRoomData.floor}
                                    onChange={(e) => setNewRoomData({ ...newRoomData, floor: e.target.value })}
                                >
                                    <option value="1">Floor 1</option>
                                    <option value="2">Floor 2</option>
                                    <option value="3">Floor 3</option>
                                </select>
                            </div>

                            <div className={styles.field}>
                                <label className={styles.label}>Device PIN *</label>
                                <input
                                    type="text"
                                    className={styles.input}
                                    placeholder="e.g. 1234"
                                    value={newRoomData.devicePin}
                                    onChange={(e) => setNewRoomData({ ...newRoomData, devicePin: e.target.value })}
                                />
                                <p className={styles.hint}>Used for room device authentication.</p>
                            </div>
                        </div>

                        <div className={styles.modalFooter}>
                            <button className={styles.cancelButton} onClick={() => setIsCreateModalOpen(false)}>Cancel</button>
                            <button className={styles.saveButton} onClick={handleCreateRoom}>Create Room</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {roomToDelete && (
                <div className={styles.modalOverlay}>
                    <div className={styles.modal}>
                        <div className={styles.modalHeader}>
                            <h2 className={styles.modalTitle}>Delete Room</h2>
                            <button className={styles.closeButton} onClick={() => setRoomToDelete(null)}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M18 6L6 18M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className={styles.modalBody}>
                            <p>Are you sure you want to delete <strong>{roomToDelete.name}</strong>? This action cannot be undone.</p>
                        </div>
                        <div className={styles.modalFooter}>
                            <button className={styles.cancelButton} onClick={() => setRoomToDelete(null)} disabled={isDeleting}>Cancel</button>
                            <button className={styles.confirmDeleteButton} onClick={confirmDelete} disabled={isDeleting}>
                                {isDeleting ? 'Deleting...' : 'Delete Room'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
