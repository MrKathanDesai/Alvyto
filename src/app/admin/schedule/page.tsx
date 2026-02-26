'use client';

import styles from '../page.module.css';

export default function SchedulePage() {
    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div>
                    <h1 className={styles.title}>Daily Schedule</h1>
                    <p className={styles.subtitle}>View appointments and room tracking</p>
                </div>
            </header>

            <div className={styles.section}>
                <div className={styles.statCard}>
                    <p>Schedule features coming soon...</p>
                </div>
            </div>
        </div>
    );
}
