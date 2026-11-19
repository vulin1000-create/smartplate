import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { School, UserProfile, UserRole } from '../types/domain';
import {
  AuthErrorInfo,
  checkAuthorizedDomainStatus,
  DomainAuthorizationStatus,
  getCurrentHostname,
} from '../lib/authUtils';
import { firebasePublicMetadata } from '../lib/firebase';
import { SchoolRepo, UserRepo } from '../lib/repositories';
import { AuthService, BootstrapService, DEFAULT_DEMO_SCHOOL_ID } from '../lib/services';

const VALID_ROLES: UserRole[] = ['student', 'parent', 'teacher', 'school_admin', 'super_admin'];

interface AuthContextValue {
  authReady: boolean;
  loadingProfile: boolean;
  isSigningIn: boolean;
  fbUser: FirebaseUser | null;
  profile: UserProfile | null;
  schools: School[];
  authErrorInfo: AuthErrorInfo | null;
  domainStatus: DomainAuthorizationStatus;
  emailVerificationRequired: boolean;
  onboardingRole: 'student' | 'parent';
  setOnboardingRole: (role: 'student' | 'parent') => void;
  onboardingSchoolId: string;
  setOnboardingSchoolId: (schoolId: string) => void;
  signInWithGoogle: (mode?: 'popup' | 'redirect') => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  reloadAuthUser: () => Promise<void>;
  clearAuthError: () => void;
  refreshDomainCheck: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authReady, setAuthReady] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [fbUser, setFbUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [schools, setSchools] = useState<School[]>([]);
  const [authErrorInfo, setAuthErrorInfo] = useState<AuthErrorInfo | null>(null);
  const [emailVerificationRequired, setEmailVerificationRequired] = useState(false);

  const [domainStatus, setDomainStatus] = useState<DomainAuthorizationStatus>(() => ({
    hostname: getCurrentHostname(),
    isAuthorized: null,
    authorizedDomains: [],
    checked: false,
    projectId: firebasePublicMetadata.projectId,
    authDomain: firebasePublicMetadata.authDomain,
  }));

  const [onboardingRole, setOnboardingRole] = useState<'student' | 'parent'>('student');
  const [onboardingSchoolId, setOnboardingSchoolId] = useState<string>(DEFAULT_DEMO_SCHOOL_ID);

  const onboardingRoleRef = useRef<'student' | 'parent'>(onboardingRole);
  const onboardingSchoolIdRef = useRef<string>(onboardingSchoolId);
  const resolvingUidRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    onboardingRoleRef.current = onboardingRole;
  }, [onboardingRole]);

  useEffect(() => {
    onboardingSchoolIdRef.current = onboardingSchoolId;
  }, [onboardingSchoolId]);

  const refreshDomainCheck = useCallback(async () => {
    const status = await checkAuthorizedDomainStatus();
    if (mountedRef.current) {
      setDomainStatus(status);
    }
  }, []);

  const resolveSignedInUser = useCallback(async (user: FirebaseUser) => {
    if (resolvingUidRef.current === user.uid) return;
    resolvingUidRef.current = user.uid;
    setLoadingProfile(true);
    setAuthErrorInfo(null);
    setEmailVerificationRequired(false);

    try {
      if (!user.emailVerified) {
        if (mountedRef.current) {
          setEmailVerificationRequired(true);
          setProfile(null);
        }
        return;
      }

      const [existing, activeSchools] = await Promise.all([
        UserRepo.getById(user.uid, { fromServer: true }),
        SchoolRepo.listActive().catch(() => []),
      ]);
      if (mountedRef.current) {
        setSchools(activeSchools);
      }

      const resolved =
        existing ||
        (await AuthService.ensureUserProfile(
          user,
          onboardingRoleRef.current,
          onboardingSchoolIdRef.current
        ));

      // Verify Firebase ID token & authoritative role/status/schoolId on backend
      const serverSession = await AuthService.verifyBackendSession(user);
      const authoritativeRole =
        serverSession && VALID_ROLES.includes(serverSession.role)
          ? serverSession.role
          : VALID_ROLES.includes(resolved.role)
            ? resolved.role
            : 'student';

      const authoritativeProfile: UserProfile = serverSession
        ? {
            ...resolved,
            role: authoritativeRole,
            schoolId: serverSession.schoolId ?? resolved.schoolId,
            status: serverSession.status || resolved.status,
          }
        : {
            ...resolved,
            role: authoritativeRole,
          };

      if (mountedRef.current) {
        setProfile(authoritativeProfile);
      }

      await BootstrapService.ensureInitialSeed(authoritativeProfile).catch((seedErr) => {
        console.warn('Bootstrap seed warning:', seedErr);
      });
    } catch (err: unknown) {
      if (mountedRef.current) {
        const mapped = AuthService.handleAuthError(err);
        setAuthErrorInfo(mapped);
        setProfile(null);
      }
    } finally {
      resolvingUidRef.current = null;
      if (mountedRef.current) {
        setLoadingProfile(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let unsub: (() => void) | undefined;

    void refreshDomainCheck();

    (async () => {
      // Process any pending signInWithRedirect result BEFORE listening/rendering auth gate
      const redirectOutcome = await AuthService.consumeRedirectResult();
      if (!mountedRef.current) return;
      if (redirectOutcome.errorInfo) {
        setAuthErrorInfo(redirectOutcome.errorInfo);
      }

      // Single authoritative onAuthStateChanged listener for the entire app
      unsub = AuthService.onAuthStateChanged(async (user) => {
        if (!mountedRef.current) return;
        setFbUser(user);
        setAuthReady(true);

        if (!user) {
          setProfile(null);
          setEmailVerificationRequired(false);
          resolvingUidRef.current = null;
          setLoadingProfile(false);
          return;
        }

        await resolveSignedInUser(user);
      });
    })();

    return () => {
      mountedRef.current = false;
      if (unsub) unsub();
    };
  }, [refreshDomainCheck, resolveSignedInUser]);

  const signInWithGoogle = useCallback(
    async (mode: 'popup' | 'redirect' = 'popup') => {
      if (isSigningIn) return;
      setAuthErrorInfo(null);
      setIsSigningIn(true);
      try {
        await AuthService.signInWithGoogle({ mode });
        // Note: onAuthStateChanged handles profile resolution once Firebase Auth completes.
      } catch (err: unknown) {
        const mapped = AuthService.handleAuthError(err);
        setAuthErrorInfo(mapped);
        if (mapped.isUnauthorizedDomain) {
          void refreshDomainCheck();
        }
      } finally {
        if (mountedRef.current) {
          setIsSigningIn(false);
        }
      }
    },
    [isSigningIn, refreshDomainCheck]
  );

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      if (isSigningIn) return;
      setAuthErrorInfo(null);
      setIsSigningIn(true);
      try {
        await AuthService.signInWithEmail(email, password);
        // onAuthStateChanged handles resolving user profile & emailVerified check.
      } catch (err: unknown) {
        const mapped = AuthService.handleAuthError(err);
        setAuthErrorInfo(mapped);
      } finally {
        if (mountedRef.current) {
          setIsSigningIn(false);
        }
      }
    },
    [isSigningIn]
  );

  const signOutUser = useCallback(async () => {
    setAuthErrorInfo(null);
    setEmailVerificationRequired(false);
    await AuthService.signOutUser();
    setProfile(null);
    setFbUser(null);
  }, []);

  const resendVerificationEmail = useCallback(async () => {
    const current = AuthService.getCurrentUser();
    if (!current) return;
    await AuthService.resendVerificationEmail(current);
  }, []);

  const reloadAuthUser = useCallback(async () => {
    const current = AuthService.getCurrentUser();
    if (!current) return;
    await current.reload();
    const refreshed = AuthService.getCurrentUser();
    if (refreshed) {
      await resolveSignedInUser(refreshed);
    }
  }, [resolveSignedInUser]);

  const clearAuthError = useCallback(() => {
    setAuthErrorInfo(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        authReady,
        loadingProfile,
        isSigningIn,
        fbUser,
        profile,
        schools,
        authErrorInfo,
        domainStatus,
        emailVerificationRequired,
        onboardingRole,
        setOnboardingRole,
        onboardingSchoolId,
        setOnboardingSchoolId,
        signInWithGoogle,
        signInWithEmail,
        signOutUser,
        resendVerificationEmail,
        reloadAuthUser,
        clearAuthError,
        refreshDomainCheck,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
