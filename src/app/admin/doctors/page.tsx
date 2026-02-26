'use client';

import styles from '../page.module.css';

export default function DoctorsPage() {
    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div>
                    <h1 className={styles.title}>Doctor Management</h1>
                    <p className={styles.subtitle}>Manage medical staff and assignments</p>
                </div>
                <button className={styles.addButton}>
                    Add Doctor
                </button>
            </header>

            <div className={styles.section}>
                <div className={styles.statCard}>
                    <p>Doctor management features coming soon...</p>
                </div>
            </div>
        </div>
    );
}
