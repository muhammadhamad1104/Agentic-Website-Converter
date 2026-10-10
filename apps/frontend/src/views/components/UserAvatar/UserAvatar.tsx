import { useState } from 'react';
import type { User } from '../../../types/auth';
import './UserAvatar.css';

export default function UserAvatar({ user, className = 'workspace-avatar' }: { user: Pick<User, 'name' | 'avatarUrl'> | null; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  return <span className={'user-avatar ' + className}>{user?.avatarUrl && failedUrl !== user.avatarUrl ? <img src={user.avatarUrl} alt="" onError={() => setFailedUrl(user.avatarUrl || '')} /> : user?.name?.trim().charAt(0).toUpperCase() || 'A'}</span>;
}
