'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import styles from './layout.module.css';

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const auth = useAuth();
    const { loaded, isAuthenticated, isAdmin, role, name } = auth;
    const isSuperAdmin = role === 'super_admin';

    // Redirect if not admin after auth state is loaded
    useEffect(() => {
        if (loaded && (!isAuthenticated || !isAdmin)) {
            router.push('/login');
        }
    }, [loaded, isAuthenticated, isAdmin, router]);
    const handleLogout = async () => {
        await auth.logout();
        router.push('/login');
    };

    if (!loaded) {
        return null;
    }

    if (!isAuthenticated || !isAdmin) {
        return null;
    }
    return (
        <div className={styles.layout}>
            {/* Sidebar */}
            <aside className={styles.sidebar}>
                <div className={styles.sidebarHeader}>
                    <div className={styles.logo}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                        </svg>
                    </div>
                    <div>
                        <span className={styles.logoText}>Alvyto</span>
                        <span className={styles.logoSub}>Admin Console</span>
                    </div>
                </div>

                <nav className={styles.nav}>
                    <span className={styles.navGroup}>Overview</span>
                    <Link href="/admin" className={`${styles.navItem} ${pathname === '/admin' ? styles.active : ''}`}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="7" height="7" />
                            <rect x="14" y="3" width="7" height="7" />
                            <rect x="14" y="14" width="7" height="7" />
                            <rect x="3" y="14" width="7" height="7" />
                        </svg>
                        Dashboard
                    </Link>
                    <Link href="/admin/queue" className={`${styles.navItem} ${pathname === '/admin/queue' ? styles.active : ''}`}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M3 12h18M3 18h18" />
                        </svg>
                        Queue
                    </Link>
                    <Link href="/admin/schedule" className={`${styles.navItem} ${pathname === '/admin/schedule' ? styles.active : ''}`}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" />
                            <path d="M16 2v4M8 2v4M3 10h18" />
                        </svg>
                        Schedule
                    </Link>

                    <span className={styles.navGroup}>Management</span>
                    <Link href="/admin/rooms" className={`${styles.navItem} ${pathname === '/admin/rooms' ? styles.active : ''}`}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
                        </svg>
                        Rooms
                    </Link>
                    <Link href="/admin/patients" className={`${styles.navItem} ${pathname?.startsWith('/admin/patients') ? styles.active : ''}`}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
                        </svg>
                        Patients
                    </Link>
                    <Link href="/admin/doctors" className={`${styles.navItem} ${pathname === '/admin/doctors' ? styles.active : ''}`}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M22 11h-6M19 8v6" />
                        </svg>
                        Doctors
                    </Link>
                    <Link href="/admin/visits" className={`${styles.navItem} ${pathname === '/admin/visits' ? styles.active : ''}`}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="16" y1="13" x2="8" y2="13" />
                            <line x1="16" y1="17" x2="8" y2="17" />
                            <line x1="10" y1="9" x2="8" y2="9" />
                        </svg>
                        Visits
                    </Link>

                    {isSuperAdmin && (
                        <>
                            <span className={styles.navGroup}>System</span>
                            <Link href="/admin/users" className={`${styles.navItem} ${pathname === '/admin/users' ? styles.active : ''}`}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                                Admin Users
                            </Link>
                            <Link href="/admin/audit-logs" className={`${styles.navItem} ${pathname === '/admin/audit-logs' ? styles.active : ''}`}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                </svg>
                                Audit Log
                            </Link>
                        </>
                    )}
                </nav>

                <div className={styles.sidebarFooter}>
                    <div className={styles.userInfo}>
                        <div className={styles.userAvatar}>
                            {name?.charAt(0) || 'A'}
                        </div>
                        <div className={styles.userName}>
                            <span>{name}</span>
                            <small>{role === 'super_admin' ? 'Super Admin' : role === 'admin' ? 'Administrator' : 'User'}</small>
                        </div>
                    </div>
                    <button onClick={handleLogout} className={styles.logoutButton}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                        </svg>
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className={styles.main}>
                {children}
            </main>
        </div>
    );
}
