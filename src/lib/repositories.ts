import {
  collection,
  deleteDoc,
  doc,
  DocumentData,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  QueryConstraint,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  AcademicYear,
  AiUsageLog,
  AuditLog,
  ConsentRecord,
  MealLog,
  MenuPlan,
  NotificationItem,
  PaginatedResult,
  ParentChildLink,
  School,
  SchoolClass,
  StudentProgress,
  StudentTask,
  SystemConfig,
  TeacherComment,
  UserProfile,
  VietnameseFood,
} from '../types/domain';
import { db, handleFirestoreError, OperationType, withRetry } from './firebase';

function toMillis(ts: any): number {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  const parsed = Date.parse(String(ts));
  return Number.isNaN(parsed) ? 0 : parsed;
}

export async function fetchPaginatedQuery<T extends DocumentData>(
  collectionPath: string,
  constraints: QueryConstraint[],
  pageSize = 20,
  cursor?: any | null,
  orderField = 'createdAt'
): Promise<PaginatedResult<T>> {
  const colRef = collection(db, collectionPath);
  const fullConstraints: QueryConstraint[] = [
    ...constraints,
    orderBy(orderField, 'desc'),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(pageSize + 1),
  ];

  try {
    const snap = await withRetry(() => getDocs(query(colRef, ...fullConstraints)));
    const docs = snap.docs;
    const hasMore = docs.length > pageSize;
    const sliced = hasMore ? docs.slice(0, pageSize) : docs;
    return {
      items: sliced.map((d) => ({ id: d.id, ...(d.data() as T) })),
      lastCursor: sliced.length > 0 ? sliced[sliced.length - 1] : null,
      hasMore,
    };
  } catch (err: any) {
    const msg = String(err?.message || err?.code || '').toLowerCase();
    // Graceful fallback if composite index has not been built yet on new DB
    if (msg.includes('failed-precondition') || msg.includes('requires an index')) {
      try {
        const fallbackSnap = await withRetry(() =>
          getDocs(query(colRef, ...constraints, limit(Math.max(50, pageSize * 3))))
        );
        const sorted = fallbackSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as T) }))
          .sort((a: any, b: any) => toMillis(b[orderField]) - toMillis(a[orderField]));
        return {
          items: sorted.slice(0, pageSize),
          lastCursor: null,
          hasMore: sorted.length > pageSize,
        };
      } catch (innerErr) {
        handleFirestoreError(innerErr, OperationType.LIST, collectionPath);
      }
    }
    handleFirestoreError(err, OperationType.LIST, collectionPath);
  }
}

function stripUndefined<T extends Record<string, any>>(obj: T): T {
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      clean[k] = v;
    }
  }
  return clean as T;
}

export const UserRepo = {
  async getById(uid: string): Promise<UserProfile | null> {
    const path = `users/${uid}`;
    try {
      const snap = await withRetry(() => getDoc(doc(db, 'users', uid)));
      return snap.exists() ? (snap.data() as UserProfile) : null;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, path);
    }
  },
  async listBySchool(schoolId: string, pageSize = 25, cursor?: any, roleFilter?: string) {
    const constraints: QueryConstraint[] = [where('schoolId', '==', schoolId)];
    if (roleFilter) constraints.push(where('role', '==', roleFilter));
    return fetchPaginatedQuery<UserProfile>('users', constraints, pageSize, cursor);
  },
  async listStudentsByTeacherClasses(schoolId: string, classIds: string[], pageSize = 60) {
    if (!classIds.length) return { items: [] as UserProfile[], lastCursor: null, hasMore: false };
    const constraints: QueryConstraint[] = [
      where('schoolId', '==', schoolId),
      where('role', '==', 'student'),
      where('classIds', 'array-contains-any', classIds.slice(0, 10)),
    ];
    return fetchPaginatedQuery<UserProfile>('users', constraints, pageSize);
  },
  async listAll(pageSize = 30, cursor?: any, roleFilter?: string) {
    const constraints: QueryConstraint[] = roleFilter ? [where('role', '==', roleFilter)] : [];
    return fetchPaginatedQuery<UserProfile>('users', constraints, pageSize, cursor);
  },
  async create(profile: Omit<UserProfile, 'createdAt' | 'updatedAt'>): Promise<void> {
    const path = `users/${profile.uid}`;
    try {
      await setDoc(doc(db, 'users', profile.uid), {
        ...stripUndefined(profile),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  },
  async update(uid: string, patch: Partial<UserProfile>): Promise<void> {
    const path = `users/${uid}`;
    try {
      await updateDoc(doc(db, 'users', uid), {
        ...stripUndefined(patch as Record<string, any>),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  },
  async delete(uid: string): Promise<void> {
    const path = `users/${uid}`;
    try {
      await deleteDoc(doc(db, 'users', uid));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  },
};

export const SchoolRepo = {
  async listActive(): Promise<School[]> {
    try {
      const snap = await withRetry(() =>
        getDocs(query(collection(db, 'schools'), where('status', '==', 'active'), limit(50)))
      );
      return snap.docs.map((d) => d.data() as School);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'schools');
    }
  },
  async listAll(pageSize = 25, cursor?: any) {
    return fetchPaginatedQuery<School>('schools', [], pageSize, cursor);
  },
  async getById(schoolId: string): Promise<School | null> {
    try {
      const snap = await withRetry(() => getDoc(doc(db, 'schools', schoolId)));
      return snap.exists() ? (snap.data() as School) : null;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `schools/${schoolId}`);
    }
  },
  async upsert(school: Omit<School, 'createdAt' | 'updatedAt'>, isNew: boolean): Promise<void> {
    const path = `schools/${school.id}`;
    try {
      if (isNew) {
        await setDoc(doc(db, 'schools', school.id), {
          ...stripUndefined(school),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, 'schools', school.id), {
          ...stripUndefined(school),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, isNew ? OperationType.CREATE : OperationType.UPDATE, path);
    }
  },
  async delete(schoolId: string): Promise<void> {
    try {
      await deleteDoc(doc(db, 'schools', schoolId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `schools/${schoolId}`);
    }
  },
};

export const AcademicYearRepo = {
  async list(schoolId: string): Promise<AcademicYear[]> {
    const path = `schools/${schoolId}/academic_years`;
    try {
      const snap = await withRetry(() => getDocs(query(collection(db, path), limit(30))));
      return snap.docs.map((d) => d.data() as AcademicYear);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  },
  async upsert(year: Omit<AcademicYear, 'createdAt' | 'updatedAt'>, isNew: boolean): Promise<void> {
    const path = `schools/${year.schoolId}/academic_years/${year.id}`;
    try {
      if (isNew) {
        await setDoc(doc(db, path), { ...stripUndefined(year), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      } else {
        await updateDoc(doc(db, path), { ...stripUndefined(year), updatedAt: serverTimestamp() });
      }
    } catch (err) {
      handleFirestoreError(err, isNew ? OperationType.CREATE : OperationType.UPDATE, path);
    }
  },
  async delete(schoolId: string, yearId: string): Promise<void> {
    const path = `schools/${schoolId}/academic_years/${yearId}`;
    try {
      await deleteDoc(doc(db, path));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  },
};

export const ClassRepo = {
  async list(schoolId: string): Promise<SchoolClass[]> {
    const path = `schools/${schoolId}/classes`;
    try {
      const snap = await withRetry(() => getDocs(query(collection(db, path), limit(100))));
      return snap.docs.map((d) => d.data() as SchoolClass);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  },
  async upsert(cls: Omit<SchoolClass, 'createdAt' | 'updatedAt'>, isNew: boolean): Promise<void> {
    const path = `schools/${cls.schoolId}/classes/${cls.id}`;
    try {
      if (isNew) {
        await setDoc(doc(db, path), { ...stripUndefined(cls), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      } else {
        await updateDoc(doc(db, path), { ...stripUndefined(cls), updatedAt: serverTimestamp() });
      }
    } catch (err) {
      handleFirestoreError(err, isNew ? OperationType.CREATE : OperationType.UPDATE, path);
    }
  },
  async delete(schoolId: string, classId: string): Promise<void> {
    const path = `schools/${schoolId}/classes/${classId}`;
    try {
      await deleteDoc(doc(db, path));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  },
};

export const ParentChildLinkRepo = {
  async listForParent(parentUid: string): Promise<ParentChildLink[]> {
    try {
      const snap = await withRetry(() =>
        getDocs(query(collection(db, 'parent_child_links'), where('parentUid', '==', parentUid), limit(30)))
      );
      return snap.docs.map((d) => d.data() as ParentChildLink);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'parent_child_links');
    }
  },
  async listForSchool(schoolId: string): Promise<ParentChildLink[]> {
    try {
      const snap = await withRetry(() =>
        getDocs(query(collection(db, 'parent_child_links'), where('schoolId', '==', schoolId), limit(100)))
      );
      return snap.docs.map((d) => d.data() as ParentChildLink);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'parent_child_links');
    }
  },
  async create(link: Omit<ParentChildLink, 'createdAt' | 'updatedAt'>): Promise<void> {
    try {
      await setDoc(doc(db, 'parent_child_links', link.id), {
        ...stripUndefined(link),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `parent_child_links/${link.id}`);
    }
  },
  async updateStatus(
    linkId: string,
    status: ParentChildLink['status'],
    verifiedByUid: string
  ): Promise<void> {
    try {
      await updateDoc(doc(db, 'parent_child_links', linkId), {
        status,
        verifiedByUid,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `parent_child_links/${linkId}`);
    }
  },
};

export const FoodRepo = {
  async listAll(limitCount = 150): Promise<VietnameseFood[]> {
    try {
      const snap = await withRetry(() => getDocs(query(collection(db, 'foods'), limit(limitCount))));
      return snap.docs.map((d) => d.data() as VietnameseFood);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'foods');
    }
  },
  async upsert(food: Omit<VietnameseFood, 'createdAt' | 'updatedAt'>, isNew: boolean): Promise<void> {
    const path = `foods/${food.id}`;
    try {
      if (isNew) {
        await setDoc(doc(db, 'foods', food.id), {
          ...stripUndefined(food),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, 'foods', food.id), {
          ...stripUndefined(food),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, isNew ? OperationType.CREATE : OperationType.UPDATE, path);
    }
  },
  async delete(foodId: string): Promise<void> {
    try {
      await deleteDoc(doc(db, 'foods', foodId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `foods/${foodId}`);
    }
  },
};

export const MealLogRepo = {
  async listForStudent(studentUid: string, pageSize = 20, cursor?: any) {
    return fetchPaginatedQuery<MealLog>('meal_logs', [where('studentUid', '==', studentUid)], pageSize, cursor);
  },
  async listForParent(parentUid: string, pageSize = 25, cursor?: any) {
    return fetchPaginatedQuery<MealLog>(
      'meal_logs',
      [where('verifiedParentIds', 'array-contains', parentUid)],
      pageSize,
      cursor
    );
  },
  async listForSchool(schoolId: string, pageSize = 30, cursor?: any, classId?: string) {
    const constraints: QueryConstraint[] = [where('schoolId', '==', schoolId)];
    if (classId) constraints.push(where('classId', '==', classId));
    return fetchPaginatedQuery<MealLog>('meal_logs', constraints, pageSize, cursor);
  },
  async listForTeacherClasses(schoolId: string, classIds: string[], pageSize = 50, cursor?: any) {
    if (!classIds.length) return { items: [] as MealLog[], lastCursor: null, hasMore: false };
    return fetchPaginatedQuery<MealLog>(
      'meal_logs',
      [where('schoolId', '==', schoolId), where('classId', 'in', classIds.slice(0, 10))],
      pageSize,
      cursor
    );
  },
  async listAll(pageSize = 30, cursor?: any) {
    return fetchPaginatedQuery<MealLog>('meal_logs', [], pageSize, cursor);
  },
  async create(log: Omit<MealLog, 'createdAt' | 'updatedAt'>): Promise<void> {
    try {
      await setDoc(doc(db, 'meal_logs', log.id), {
        ...stripUndefined(log),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `meal_logs/${log.id}`);
    }
  },
  async update(logId: string, patch: Partial<MealLog>): Promise<void> {
    try {
      await updateDoc(doc(db, 'meal_logs', logId), {
        ...stripUndefined(patch as Record<string, any>),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `meal_logs/${logId}`);
    }
  },
  async delete(logId: string): Promise<void> {
    try {
      await deleteDoc(doc(db, 'meal_logs', logId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `meal_logs/${logId}`);
    }
  },
};

export const MenuRepo = {
  async listForSchool(schoolId: string, pageSize = 20, cursor?: any) {
    return fetchPaginatedQuery<MenuPlan>('menus', [where('schoolId', '==', schoolId)], pageSize, cursor);
  },
  async listAll(pageSize = 25, cursor?: any) {
    return fetchPaginatedQuery<MenuPlan>('menus', [], pageSize, cursor);
  },
  async upsert(menu: Omit<MenuPlan, 'createdAt' | 'updatedAt'>, isNew: boolean): Promise<void> {
    const path = `menus/${menu.id}`;
    try {
      if (isNew) {
        await setDoc(doc(db, 'menus', menu.id), {
          ...stripUndefined(menu),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, 'menus', menu.id), {
          ...stripUndefined(menu),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, isNew ? OperationType.CREATE : OperationType.UPDATE, path);
    }
  },
  async delete(menuId: string): Promise<void> {
    try {
      await deleteDoc(doc(db, 'menus', menuId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `menus/${menuId}`);
    }
  },
};

export const TeacherCommentRepo = {
  async listForStudent(studentUid: string, pageSize = 20, cursor?: any) {
    return fetchPaginatedQuery<TeacherComment>(
      'teacher_comments',
      [where('studentUid', '==', studentUid)],
      pageSize,
      cursor
    );
  },
  async listForParent(parentUid: string, pageSize = 20, cursor?: any) {
    return fetchPaginatedQuery<TeacherComment>(
      'teacher_comments',
      [where('verifiedParentIds', 'array-contains', parentUid)],
      pageSize,
      cursor
    );
  },
  async listForSchool(schoolId: string, pageSize = 30, cursor?: any) {
    return fetchPaginatedQuery<TeacherComment>(
      'teacher_comments',
      [where('schoolId', '==', schoolId)],
      pageSize,
      cursor
    );
  },
  async listForTeacherClasses(schoolId: string, classIds: string[], pageSize = 30, cursor?: any) {
    if (!classIds.length) return { items: [] as TeacherComment[], lastCursor: null, hasMore: false };
    return fetchPaginatedQuery<TeacherComment>(
      'teacher_comments',
      [where('schoolId', '==', schoolId), where('classId', 'in', classIds.slice(0, 10))],
      pageSize,
      cursor
    );
  },
  async create(comment: Omit<TeacherComment, 'createdAt' | 'updatedAt'>): Promise<void> {
    try {
      await setDoc(doc(db, 'teacher_comments', comment.id), {
        ...stripUndefined(comment),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `teacher_comments/${comment.id}`);
    }
  },
  async update(commentId: string, patch: Partial<TeacherComment>): Promise<void> {
    try {
      await updateDoc(doc(db, 'teacher_comments', commentId), {
        ...stripUndefined(patch as Record<string, any>),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `teacher_comments/${commentId}`);
    }
  },
  async delete(commentId: string): Promise<void> {
    try {
      await deleteDoc(doc(db, 'teacher_comments', commentId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `teacher_comments/${commentId}`);
    }
  },
};

export const StudentTaskRepo = {
  async listForSchool(schoolId: string, classId?: string) {
    const constraints: QueryConstraint[] = [where('schoolId', '==', schoolId)];
    if (classId) constraints.push(where('classId', '==', classId));
    return fetchPaginatedQuery<StudentTask>('student_tasks', constraints, 40);
  },
  async create(task: Omit<StudentTask, 'createdAt' | 'updatedAt'>): Promise<void> {
    try {
      await setDoc(doc(db, 'student_tasks', task.id), {
        ...stripUndefined(task),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `student_tasks/${task.id}`);
    }
  },
  async delete(taskId: string): Promise<void> {
    try {
      await deleteDoc(doc(db, 'student_tasks', taskId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `student_tasks/${taskId}`);
    }
  },
};

export const StudentProgressRepo = {
  async get(studentUid: string): Promise<StudentProgress | null> {
    try {
      const snap = await withRetry(() => getDoc(doc(db, 'student_progress', studentUid)));
      return snap.exists() ? (snap.data() as StudentProgress) : null;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `student_progress/${studentUid}`);
    }
  },
  async upsert(progress: Omit<StudentProgress, 'updatedAt'>): Promise<void> {
    try {
      await setDoc(
        doc(db, 'student_progress', progress.studentUid),
        { ...stripUndefined(progress), updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `student_progress/${progress.studentUid}`);
    }
  },
};

export const ConsentRepo = {
  async listForUser(userId: string): Promise<ConsentRecord[]> {
    try {
      const snap = await withRetry(() =>
        getDocs(query(collection(db, 'consent_records'), where('userId', '==', userId), limit(50)))
      );
      return snap.docs.map((d) => d.data() as ConsentRecord);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'consent_records');
    }
  },
  async listForStudent(subjectStudentUid: string): Promise<ConsentRecord[]> {
    try {
      const snap = await withRetry(() =>
        getDocs(
          query(collection(db, 'consent_records'), where('subjectStudentUid', '==', subjectStudentUid), limit(50))
        )
      );
      return snap.docs.map((d) => d.data() as ConsentRecord);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'consent_records');
    }
  },
  async upsert(record: Omit<ConsentRecord, 'createdAt' | 'updatedAt'>, isNew: boolean): Promise<void> {
    const path = `consent_records/${record.id}`;
    try {
      if (isNew) {
        await setDoc(doc(db, 'consent_records', record.id), {
          ...stripUndefined(record),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, 'consent_records', record.id), {
          ...stripUndefined(record),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, isNew ? OperationType.CREATE : OperationType.UPDATE, path);
    }
  },
};

export const AuditLogRepo = {
  async list(schoolId?: string, pageSize = 25, cursor?: any) {
    const constraints: QueryConstraint[] = schoolId ? [where('schoolId', '==', schoolId)] : [];
    return fetchPaginatedQuery<AuditLog>('audit_logs', constraints, pageSize, cursor);
  },
  async create(log: Omit<AuditLog, 'createdAt'>): Promise<void> {
    try {
      await setDoc(doc(db, 'audit_logs', log.id), {
        ...stripUndefined(log),
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `audit_logs/${log.id}`);
    }
  },
};

export const AiUsageLogRepo = {
  async list(schoolId?: string, pageSize = 50, cursor?: any) {
    const constraints: QueryConstraint[] = schoolId ? [where('schoolId', '==', schoolId)] : [];
    return fetchPaginatedQuery<AiUsageLog>('ai_usage_logs', constraints, pageSize, cursor);
  },
  async create(log: Omit<AiUsageLog, 'createdAt'>): Promise<void> {
    try {
      await setDoc(doc(db, 'ai_usage_logs', log.id), {
        ...stripUndefined(log),
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `ai_usage_logs/${log.id}`);
    }
  },
};

export const SystemConfigRepo = {
  async getGlobal(): Promise<SystemConfig | null> {
    try {
      const snap = await withRetry(() => getDoc(doc(db, 'system_config', 'global')));
      return snap.exists() ? (snap.data() as SystemConfig) : null;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'system_config/global');
    }
  },
  async saveGlobal(cfg: Omit<SystemConfig, 'updatedAt'>): Promise<void> {
    try {
      await setDoc(doc(db, 'system_config', 'global'), {
        ...stripUndefined(cfg),
        configId: 'global',
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'system_config/global');
    }
  },
};

export const NotificationRepo = {
  async listForUser(recipientUid: string, pageSize = 20): Promise<NotificationItem[]> {
    const res = await fetchPaginatedQuery<NotificationItem>(
      'notifications',
      [where('recipientUid', '==', recipientUid)],
      pageSize
    );
    return res.items;
  },
  async create(notif: Omit<NotificationItem, 'createdAt'>): Promise<void> {
    try {
      await setDoc(doc(db, 'notifications', notif.id), {
        ...stripUndefined(notif),
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `notifications/${notif.id}`);
    }
  },
  async markRead(notifId: string): Promise<void> {
    try {
      await updateDoc(doc(db, 'notifications', notifId), { read: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `notifications/${notifId}`);
    }
  },
};
