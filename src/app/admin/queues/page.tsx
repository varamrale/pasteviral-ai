import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'

export default async function QueuesPage() {
  const session = await auth()

  if (!session?.user?.email || session.user.email !== process.env.ADMIN_EMAIL) {
    redirect('/')
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="border-b px-6 py-4">
        <h1 className="text-xl font-semibold">Queue Dashboard</h1>
        <p className="text-sm text-muted-foreground">BullMQ queue monitor</p>
      </div>
      <iframe
        src="/api/admin/queues"
        className="flex-1 w-full border-0"
        title="Bull Board"
      />
    </div>
  )
}
