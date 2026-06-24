import { useAuth } from '../context/AuthContext'

export default function NoAccess() {
  const { user, signOut } = useAuth()
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="panel max-w-md p-8 text-center">
        <h1 className="font-display text-2xl font-extrabold text-ice">No workspace assigned</h1>
        <p className="mt-3 text-sm text-ice-faint">
          You're signed in as <span className="text-ice">{user?.email}</span>, but no organization is
          linked to this account yet. WorkFlow Solutions provisions access per client.
        </p>
        <p className="mt-4 text-sm text-ice-faint">
          Reach <a className="text-accent hover:underline" href="mailto:admin@workflow-app.net">admin@workflow-app.net</a> to be added to your company workspace.
        </p>
        <button onClick={signOut} className="btn-ghost mt-6">Sign out</button>
      </div>
    </div>
  )
}
