import { useQuery } from '@tanstack/react-query';
import { Redirect, Route, Switch } from 'wouter';
import type { MeResponse } from '../../shared/types';
import { errorMessage } from './api';
import { FormError } from './components/Fields';
import { TabBar } from './components/TabBar';
import { BoardScreen } from './screens/BoardScreen';
import { ComingSoonScreen } from './screens/ComingSoonScreen';
import { MembersScreen } from './screens/MembersScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SetupScreen } from './screens/SetupScreen';
import { SignInScreen } from './screens/SignInScreen';
import { MeProvider, meQuery, setupStatusQuery } from './session';
import { strings } from './strings';

export function App() {
  const status = useQuery(setupStatusQuery);
  const me = useQuery({ ...meQuery, enabled: status.data?.needs_setup === false });

  if (status.isPending) return <Splash />;
  if (status.isError) return <LoadError error={status.error} retry={() => void status.refetch()} />;
  if (status.data.needs_setup) return <SetupScreen />;
  if (me.isPending) return <Splash />;
  if (me.isError) return <LoadError error={me.error} retry={() => void me.refetch()} />;
  if (!me.data) return <SignInScreen />;
  return <Shell me={me.data} />;
}

function Shell({ me }: { me: MeResponse }) {
  const isOwner = me.member.role === 'owner';
  return (
    <MeProvider value={me}>
      <div className="app">
        <Switch>
          <Route path="/" component={BoardScreen} />
          <Route path="/beans">
            <ComingSoonScreen section="beans" />
          </Route>
          <Route path="/recipes">
            <ComingSoonScreen section="recipes" />
          </Route>
          <Route path="/brew">
            <ComingSoonScreen section="brew" />
          </Route>
          <Route path="/duel">
            <ComingSoonScreen section="duel" />
          </Route>
          <Route path="/coach">
            <ComingSoonScreen section="coach" />
          </Route>
          <Route path="/settings" component={SettingsScreen} />
          <Route path="/settings/members">{isOwner ? <MembersScreen /> : <Redirect to="/settings" replace />}</Route>
          <Route>
            <Redirect to="/" replace />
          </Route>
        </Switch>
        <TabBar />
      </div>
    </MeProvider>
  );
}

function Splash() {
  return (
    <div className="center-screen">
      <div className="spinner" role="status" aria-label={strings.app.loading} />
    </div>
  );
}

function LoadError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="center-screen">
      <div style={{ display: 'grid', gap: 16, maxWidth: 360 }}>
        <FormError>{errorMessage(error) || strings.errors.loadFailed}</FormError>
        <button type="button" className="btn block" onClick={retry}>
          {strings.common.retry}
        </button>
      </div>
    </div>
  );
}
