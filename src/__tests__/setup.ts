import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => ({
    get: vi.fn(),
  }),
  usePathname: () => '',
}));

// Mock next-auth/react
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: {
      user: {
        id: 'test-user-id',
        email: 'test@example.com',
        name: 'Test User',
        plan: 'trial',
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
    status: 'authenticated',
  }),
  signIn: vi.fn(),
  signOut: vi.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock fetch globally
global.fetch = vi.fn();

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  ChevronRight: () => null,
  ChevronDown: () => null,
  Folder: () => null,
  FolderOpen: () => null,
  Plus: () => null,
  MoreVertical: () => null,
  Pencil: () => null,
  Trash2: () => null,
  FolderPlus: () => null,
  Globe: () => null,
  FileText: () => null,
  Search: () => null,
  X: () => null,
  Check: () => null,
  AlertCircle: () => null,
  Info: () => null,
  Settings: () => null,
  User: () => null,
  LogOut: () => null,
  Menu: () => null,
  Home: () => null,
  Play: () => null,
  Edit: () => null,
  Copy: () => null,
  Download: () => null,
  Upload: () => null,
  RefreshCw: () => null,
  Loader2: () => null,
  Eye: () => null,
  EyeOff: () => null,
  Lock: () => null,
  Unlock: () => null,
  Shield: () => null,
  Key: () => null,
  ArrowLeft: () => null,
  ArrowRight: () => null,
  ArrowUp: () => null,
  ArrowDown: () => null,
  ExternalLink: () => null,
  Link: () => null,
  Mail: () => null,
  Calendar: () => null,
  Clock: () => null,
  Star: () => null,
  Heart: () => null,
  Bell: () => null,
  Filter: () => null,
  SortAsc: () => null,
  SortDesc: () => null,
  LayoutGrid: () => null,
  List: () => null,
  Grid: () => null,
  Table: () => null,
  Code: () => null,
  Terminal: () => null,
  Database: () => null,
  Server: () => null,
  Cloud: () => null,
  Wifi: () => null,
  Zap: () => null,
  Activity: () => null,
  BarChart: () => null,
  PieChart: () => null,
  TrendingUp: () => null,
  TrendingDown: () => null,
}));
