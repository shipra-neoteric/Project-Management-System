import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-5xl font-medium text-gray-300 dark:text-gray-600">404</p>
      <p className="text-base font-medium text-gray-500 dark:text-gray-400">This page does not exist.</p>
      <Link href="/dashboard" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
        Back to the dashboard
      </Link>
    </div>
  );
}
