import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { School, UserProfile } from '../types/domain';
import {
  AuthErrorInfo,
  AuthProfileState,
  checkAuthorizedDomainStatus,
  classifyProfileError,
  DomainAuthorizationStatus,
  getCurrentHostname,
} from '../lib/authUtils';
import { firebasePublicMetadata } from '../lib/firebase';
import { SchoolRepo, UserRepo } from '../lib/repositories';
import { AuthService, BootstrapService, DEFAULT_DEMO_SCHOOL_ID } from '../lib/services';

interface AuthContextValue {
  authReady: boolean;
  loadingProfile: boolean;
  isSigningIn: boolean;
  profileState: AuthProfileState;
  fbUser: FirebaseUser | null;
  profile: UserProfile | null;
  schools: School[];
  authErrorInfo: AuthErrorInfo | null;
  profileErrorMessage: string;
  domainStatus: DomainAuthorizationStatus;
  emailVerificationRequired: boolean;
  onboardingRole: 'student' | 'parent';
  setOnboardingRole: (role: 'student' | 'parent') => void;
  onboardingSchoolId: string;
  setOnboardingSchoolId: (schoolId: string) => void;
  signInWithGoogle: (mode?: 'popup' | 'redirect') => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  retryProfileLoad: () => Promise<void>;
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
  const [profileState, setProfileState] = useState<AuthProfileState>('UNAUTHENTICATED');
  const [fbUser, setFbUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [schools, setSchools] = useState<School[]>([]);
  const [authErrorInfo, setAuthErrorInfo] = useState<AuthErrorInfo | null>(null);
  const [profileErrorMessage, setProfileErrorMessage] = useState('');
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
    setProfileState('AUTHENTICATED');
    setLoadingProfile(true);
    setAuthErrorInfo(null);
    setProfileErrorMessage('');
    setEmailVerificationRequired(false);

    try {
      if (!user.emailVerified) {
        if (mountedRef.current) {
          setEmailVerificationRequired(true);
          setProfile(null);
          setProfileState('PROFILE_PENDING');
        }
        return;
      }

      if (mountedRef.current) {
        setProfileState('PROFILE_LOADING');
      }

      const [existing, activeSchools] = await Promise.all([
        UserRepo.getById(user.uid, { fromServer: true }),
        SchoolRepo.listActive().catch(() => []),
      ]);
      if (mountedRef.current) {
        setSchools(activeSchools);
      }

      let resolved: UserProfile;
      if (!existing) {
        if (mountedRef.current) {
          setProfileState('PROFILE_NOT_FOUND');
        }
        console.info('[AuthProfile][PROFILE_NOT_FOUND] Khởi tạo hồ sơ mới cho UID:', user.uid);
        resolved = await AuthService.ensureUserProfile(
          user,
          onboardingRoleRef.current,
          onboardingSchoolIdRef.current
        );
      } else {
        resolved = existing;
      }

      // Validate required fields & authoritative role/status
      const validated = AuthService.validateLoadedUserProfile(resolved, user.uid);
      const serverSession = await AuthService.verifyBackendSession(user);

      const mergedProfile: UserProfile = serverSession
        ? AuthService.validateLoadedUserProfile(
            {
              ...validated,
              role: serverSession.role,
              schoolId: serverSession.schoolId ?? validated.schoolId,
              status: serverSession.status || validated.status,
            },
            user.uid
          )
        : validated;

      if (mountedRef.current) {
        setProfile(mergedProfile);
        if (mergedProfile.status === 'suspended' || mergedProfile.status === 'deleted') {
          setProfileState('PROFILE_DISABLED');
        } else if (mergedProfile.status === 'pending_verification') {
          setProfileState('PROFILE_PENDING');
        } else {
          setProfileState('PROFILE_ACTIVE');
        }
      }

      if (mergedProfile.status === 'active') {
        await BootstrapService.ensureInitialSeed(mergedProfile).catch((seedErr) => {
          console.warn('[BootstrapService] Seed warning:', seedErr);
        });
      }
    } catch (err: unknown) {
      if (mountedRef.current) {
        const classified = classifyProfileError(err);
        setProfile(null);
        setProfileState(classified.state);
        setProfileErrorMessage(classified.message);
        setAuthErrorInfo(AuthService.handleAuthError(err));
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
      const redirectOutcome = await AuthService.consumeRedirectResult();
      if (!mountedRef.current) return;
      if (redirectOutcome.errorInfo) {
        setAuthErrorInfo(redirectOutcome.errorInfo);
      }

      unsub = AuthService.onAuthStateChanged(async (user) => {
        if (!mountedRef.current) return;
        setFbUser(user);
        setAuthReady(true);

        if (!user) {
          setProfile(null);
          setProfileState('UNAUTHENTICATED');
          setProfileErrorMessage('');
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
      setProfileErrorMessage('');
      setIsSigningIn(true);
      try {
        await AuthService.signInWithGoogle({ mode });
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
      setProfileErrorMessage('');
      setIsSigningIn(true);
      try {
        await AuthService.signInWithEmail(email, password);
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
    setProfileErrorMessage('');
    setEmailVerificationRequired(false);
    await AuthService.signOutUser();
    setProfile(null);
    setFbUser(null);
    setProfileState('UNAUTHENTICATED');
  }, []);

  const retryProfileLoad = useCallback(async () => {
    const current = AuthService.getCurrentUser();
    if (!current) return;
    await resolveSignedInUser(current);
  }, [resolveSignedInUser]);

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
        profileState,
        fbUser,
        profile,
        schools,
        authErrorInfo,
        profileErrorMessage,
        domainStatus,
        emailVerificationRequired,
        onboardingRole,
        setOnboardingRole,
        onboardingSchoolId,
        setOnboardingSchoolId,
        signInWithGoogle,
        signInWithEmail,
        signOutUser,
        retryProfileLoad,
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
