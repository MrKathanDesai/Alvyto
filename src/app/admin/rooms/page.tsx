'use client';

import { useState, useEffect } from 'react';
import { useRooms } from '@/contexts/RoomContext';
import { getPatients, getDoctors, getQueue, updateQueueEntry, getRoomsWithStatus } from '@/services/api';
import { Room, Doctor, EMRPatient, RoomStatus } from '@/types/emr';
import styles from './page.module.css';

type RoomFilter = 'all' | 'idle' | 'in_use' | 'cleaning' | 'offline';

function formatRoomStatus(status: string): string {
    if (status === 'idle') return 'Idle';
    if (status === 'in_use') return 'In Use';
    if (status === 'cleaning') return 'Cleaning';
    if (status === 'offline') return 'Offline';
    return status;
}

export default function RoomsPage() {
    const { rooms, assignPatient, assignDoctor, dischargePatient, unassignDoctor, updateRoom, createRoom, deleteRoom, refreshRooms } = useRooms();
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<RoomFilter>('all');
    // Data State
    const [patients, setPatients] = useState<EMRPatient[]>([]);
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [patientsMap, setPatientsMap] = useState<Record<string, EMRPatient>>({});
    const [doctorsMap, setDoctorsMap] = useState<Record<string, Doctor>>({});
    const [roomStatuses, setRoomStatuses] = useState<Record<string, RoomStatus>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Edit Modal state
    const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
    const [selectedPatientId, setSelectedPatientId] = useState<string>('');
    const [selectedStatus, setSelectedStatus] = useState<Room['status']>('idle');
    const [doctorSearchTerm, setDoctorSearchTerm] = useState('');
    const [patientSearchTerm, setPatientSearchTerm] = useState('');
    // Create Modal state
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [newRoomData, setNewRoomData] = useState({
        name: '',
        floor: '1',
        devicePin: '',
    });
    // Delete confirmation state
    const [roomToDelete, setRoomToDelete] = useState<Room | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // Load Data
    useEffect(() => {
        async function loadData() {
            try {
                setError(null);
                const [patientsData, doctorsData, roomStatusesData] = await Promise.all([
                    getPatients(),
                    getDoctors(false),
                    getRoomsWithStatus()
                ]);

                setPatients(patientsData);
                setDoctors(doctorsData);

                // Index by ID for quick lookup
                setPatientsMap(
                    patientsData.reduce((acc: Record<string, EMRPatient>, p: EMRPatient) => {
                        acc[p.id] = p;
                        return acc;
                    }, {} as Record<string, EMRPatient>),
                );
                setDoctorsMap(
                    doctorsData.reduce((acc: Record<string, Doctor>, d: Doctor) => {
                        acc[d.id] = d;
                        return acc;
                    }, {} as Record<string, Doctor>),
                );
                
                // Index room statuses by room ID for quick lookup
                setRoomStatuses(
                    roomStatusesData.reduce((acc: Record<string, RoomStatus>, rs: RoomStatus) => {
                        acc[rs.room.id] = rs;
                        return acc;
                    }, {} as Record<string, RoomStatus>),
                );
            } catch (loadError) {
                console.error('Failed to load room management data', loadError);
                setError(loadError instanceof Error ? loadError.message : 'Failed to load room management data.');
            } finally {
                setLoading(false);
            }
        }

        void loadData();
    }, []);

    // Filter rooms
    const filteredRooms = rooms.filter((room) => {
        const matchesSearch = room.name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = filterStatus === 'all' || room.status === filterStatus;
        return matchesSearch && matchesStatus;
    });

    const filteredDoctorOptions = doctorSearchTerm.trim() === ''
        ? doctors
        : doctors.filter((d) => d.name.toLowerCase().includes(doctorSearchTerm.toLowerCase()) || (d.specialty ?? '').toLowerCase().includes(doctorSearchTerm.toLowerCase()));

    const filteredPatientOptions = patientSearchTerm.trim() === ''
        ? patients
        : patients.filter((p) => {
            const name = (p.name ?? '').toLowerCase();
            const mrn = (p.mrn ?? '').toLowerCase();
            const q = patientSearchTerm.toLowerCase();
            return name.includes(q) || mrn.includes(q);
        });

    const handleEditClick = (room: Room) => {
        setSelectedRoom(room);
        setSelectedDoctorId(room.assignedDoctorId || '');
        setSelectedPatientId(room.currentPatientId || '');
        setSelectedStatus(room.status);
        // Initialize search terms with current names
        const currentDoctor = room.assignedDoctorId ? doctorsMap[room.assignedDoctorId] : null;
        const currentPatient = room.currentPatientId ? patientsMap[room.currentPatientId] : null;
        setDoctorSearchTerm(currentDoctor ? currentDoctor.name : '');
        setPatientSearchTerm(currentPatient ? currentPatient.name : '');
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        if (!selectedRoom) return;

        try {
            setError(null);

            // Update Doctor
            if (selectedDoctorId && selectedDoctorId !== selectedRoom.assignedDoctorId) {
                await assignDoctor(selectedRoom.id, selectedDoctorId);
            } else if (!selectedDoctorId && selectedRoom.assignedDoctorId) {
                await unassignDoctor(selectedRoom.id);
            }

            // Update Patient
            if (selectedPatientId && selectedPatientId !== selectedRoom.currentPatientId) {
                await assignPatient(selectedRoom.id, selectedPatientId);

                // Sync queue entry: find and mark as in_room
                try {
                    const queueSummary = await getQueue();
                    const entry = queueSummary.entries.find(
                        (e) => e.patientId === selectedPatientId
                            && (e.status === 'waiting' || e.status === 'called'),
                    );
                    if (entry) {
                        await updateQueueEntry(entry.id, { status: 'in_room', roomId: selectedRoom.id });
                    }
                } catch (e) {
                    console.error('Failed to sync queue entry on room assignment:', e);
                }
            } else if (!selectedPatientId && selectedRoom.currentPatientId) {
                await dischargePatient(selectedRoom.id);

                // Sync queue entry: find and mark as done
                try {
                    const queueSummary = await getQueue();
                    const entry = queueSummary.entries.find(
                        (e) => e.roomId === selectedRoom.id && e.status === 'in_room',
                    );
                    if (entry) {
                        await updateQueueEntry(entry.id, { status: 'done' });
                    }
                } catch (e) {
                    console.error('Failed to sync queue entry on discharge:', e);
                }
            }
            // Update status if it changed
            if (selectedStatus !== selectedRoom.status) {
                await updateRoom(selectedRoom.id, { status: selectedStatus });
            }
            await refreshRooms();
            setIsModalOpen(false);
            setSelectedRoom(null);
        } catch (saveError) {
            console.error('Failed to save room assignments', saveError);
            setError(saveError instanceof Error ? saveError.message : 'Failed to save room assignments.');
        }
    };
    const handleCreateRoom = async () => {
        if (!newRoomData.name || !newRoomData.devicePin) {
            setError('Please fill in all required fields.');
            return;
        }

        if (!/^\d{4,8}$/.test(newRoomData.devicePin.trim())) {
            setError('Device PIN must be 4 to 8 digits.');
            return;
        }

        try {
            setError(null);
            await createRoom({
                name: newRoomData.name,
                floor: parseInt(newRoomData.floor, 10) || 1,
                device_pin: newRoomData.devicePin,
            });
            await refreshRooms();
            setIsCreateModalOpen(false);
            setNewRoomData({ name: '', floor: '1', devicePin: '' });
        } catch (createError) {
            console.error('Failed to create room', createError);
            setError(createError instanceof Error ? createError.message : 'Failed to create room. Please try again.');
        }
    };

    const handleDeleteRoom = (room: Room) => {
        if (room.currentPatientId) {
            setError(`Cannot delete ${room.name} — a patient is currently assigned. Discharge the patient first.`);
            return;
        }
        setRoomToDelete(room);
    };

    const confirmDelete = async () => {
        if (!roomToDelete) return;

        setIsDeleting(true);
        setError(null);

        try {
            await deleteRoom(roomToDelete.id);
            await refreshRooms();
            setRoomToDelete(null);
        } catch (deleteError) {
            console.error('Failed to delete room', deleteError);
            setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete room. Please try again.');
        } finally {
            setIsDeleting(false);
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

            {error && (
                <div className="error-msg" role="alert">
                    {error}
                </div>
            )}

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
                        className={`${styles.filterButton} ${filterStatus === 'idle' ? styles.active : ''}`}
                        onClick={() => setFilterStatus('idle')}
                    >
                        Idle
                    </button>
                    <button
                        className={`${styles.filterButton} ${filterStatus === 'in_use' ? styles.active : ''}`}
                        onClick={() => setFilterStatus('in_use')}
                    >
                        In Use
                    </button>
                    <button
                        className={`${styles.filterButton} ${filterStatus === 'cleaning' ? styles.active : ''}`}
                        onClick={() => setFilterStatus('cleaning')}
                    >
                        Cleaning
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
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredRooms.map((room) => {
                            const patient = room.currentPatientId ? patientsMap[room.currentPatientId] : null;
                            const doctor = room.assignedDoctorId ? doctorsMap[room.assignedDoctorId] : null;

                            return (
                                <tr key={room.id}>
                                    <td>
                                        <div className={styles.roomInfo}>
                                            <span className={styles.roomName}>{room.name}</span>
                                            <span className={styles.roomFloor}>{room.floor ?? 'No floor set'}</span>
                                        </div>
                                    </td>
                                    <td>
                                        <span className={`${styles.statusBadge} ${styles[room.status]}`}>
                                            {formatRoomStatus(room.status)}
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
                                                 <div className={styles.patientDetails}>
                                                     <span>{patient.name}</span>
                                                     {roomStatuses[room.id]?.chiefComplaint && (
                                                         <span className={styles.chiefComplaint}>
                                                             {roomStatuses[room.id].chiefComplaint}
                                                         </span>
                                                     )}
                                                 </div>
                                             </div>
                                         ) : (
                                             <span className={styles.empty}>Empty</span>
                                         )}
                                     </td>
                                    <td>
                                        <div className={styles.actionGroup}>
                                            <button className={styles.actionButton} onClick={() => handleEditClick(room)}>
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
                <div className={styles.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) setIsModalOpen(false); }}>
                    <div
                        className={styles.modal}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="edit-room-modal-title"
                        onKeyDown={(e) => { if (e.key === 'Escape') setIsModalOpen(false); }}
                    >
                        <div className={styles.modalHeader}>
                            <h2 id="edit-room-modal-title" className={styles.modalTitle}>Manage {selectedRoom.name}</h2>
                            <button className={styles.closeButton} onClick={() => setIsModalOpen(false)} aria-label="Close dialog">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                    <path d="M18 6L6 18M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className={styles.modalBody}>
                            <div className={styles.field}>
                                <label className={styles.label}>Room Status</label>
                                <select
                                    className={styles.select}
                                    value={selectedStatus}
                                    onChange={(e) => setSelectedStatus(e.target.value as Room['status'])}
                                >
                                    <option value="idle">Idle — Available for use</option>
                                    <option value="in_use">In Use — Patient currently in room</option>
                                    <option value="cleaning">Cleaning — Being cleaned / prepared</option>
                                    <option value="offline">Offline — Out of service</option>
                                </select>
                                <p className={styles.hint}>
                                    Manually override the room status. Assigning a patient will automatically set it to In Use.
                                </p>
                            </div>

                            <div className={styles.field}>
                                <label className={styles.label}>Assigned Doctor</label>
                                <div className={styles.searchCombobox}>
                                    <input
                                        type="text"
                                        className={styles.input}
                                        placeholder="Search doctor by name or specialty…"
                                        value={doctorSearchTerm}
                                        onChange={(e) => {
                                            setDoctorSearchTerm(e.target.value);
                                            setSelectedDoctorId('');
                                        }}
                                        autoComplete="off"
                                    />
                                    {doctorSearchTerm.trim() !== '' && !selectedDoctorId && (
                                        <div className={styles.comboDropdown}>
                                            <div
                                                className={styles.comboItem}
                                                onClick={() => { setSelectedDoctorId(''); setDoctorSearchTerm(''); }}
                                            >
                                                <span className={styles.comboName}>— Unassigned —</span>
                                            </div>
                                            {filteredDoctorOptions.length === 0 ? (
                                                <div className={styles.comboEmpty}>No doctors found</div>
                                            ) : (
                                                filteredDoctorOptions.map((doc) => (
                                                    <div
                                                        key={doc.id}
                                                        className={[styles.comboItem, selectedDoctorId === doc.id ? styles.comboItemSelected : ''].join(' ')}
                                                        onClick={() => { setSelectedDoctorId(doc.id); setDoctorSearchTerm(doc.name); }}
                                                    >
                                                        <span className={styles.comboName}>{doc.name}</span>
                                                        <span className={styles.comboMeta}>{doc.specialty}</span>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}
                                    {selectedDoctorId && (
                                        <div className={styles.selectedIndicator}>
                                            ✓ {doctorsMap[selectedDoctorId]?.name} selected
                                            <button
                                                type="button"
                                                className={styles.clearBtn}
                                                onClick={() => { setSelectedDoctorId(''); setDoctorSearchTerm(''); }}
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className={styles.field}>
                                <label className={styles.label}>Current Patient</label>
                                <div className={styles.searchCombobox}>
                                    <input
                                        type="text"
                                        className={styles.input}
                                        placeholder="Search patient by name or MRN…"
                                        value={patientSearchTerm}
                                        onChange={(e) => {
                                            setPatientSearchTerm(e.target.value);
                                            setSelectedPatientId('');
                                        }}
                                        autoComplete="off"
                                    />
                                    {patientSearchTerm.trim() !== '' && !selectedPatientId && (
                                        <div className={styles.comboDropdown}>
                                            <div
                                                className={styles.comboItem}
                                                onClick={() => { setSelectedPatientId(''); setPatientSearchTerm(''); }}
                                            >
                                                <span className={styles.comboName}>— No Patient —</span>
                                            </div>
                                            {filteredPatientOptions.length === 0 ? (
                                                <div className={styles.comboEmpty}>No patients found</div>
                                            ) : (
                                                filteredPatientOptions.map((p) => (
                                                    <div
                                                        key={p.id}
                                                        className={[styles.comboItem, selectedPatientId === p.id ? styles.comboItemSelected : ''].join(' ')}
                                                        onClick={() => { setSelectedPatientId(p.id); setPatientSearchTerm(p.name); }}
                                                    >
                                                        <span className={styles.comboName}>{p.name}</span>
                                                        <span className={styles.comboMeta}>{p.mrn}</span>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}
                                    {selectedPatientId && (
                                        <div className={styles.selectedIndicator}>
                                            ✓ {patientsMap[selectedPatientId]?.name} selected
                                            <button
                                                type="button"
                                                className={styles.clearBtn}
                                                onClick={() => { setSelectedPatientId(''); setPatientSearchTerm(''); }}
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <p className={styles.hint}>
                                    Assigning a patient will mark the room as in_use.
                                    Removing a patient will discharge and reset the room to idle.
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
                <div className={styles.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) setIsCreateModalOpen(false); }}>
                    <div
                        className={styles.modal}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="create-room-modal-title"
                        onKeyDown={(e) => { if (e.key === 'Escape') setIsCreateModalOpen(false); }}
                    >
                        <div className={styles.modalHeader}>
                            <h2 id="create-room-modal-title" className={styles.modalTitle}>Add New Room</h2>
                            <button className={styles.closeButton} onClick={() => setIsCreateModalOpen(false)} aria-label="Close dialog">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
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
                                    <option value="">No floor</option>
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
