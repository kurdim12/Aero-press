import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, Route, Switch } from 'wouter';
import type { MeResponse } from '../../shared/types';
import { errorMessage } from './api';
import { FormError } from './components/Fields';
import { TabBar } from './components/TabBar';
import { BeanFormScreen } from './screens/BeanFormScreen';
import { BeansScreen } from './screens/BeansScreen';
import { BoardScreen } from './screens/BoardScreen';
import { BrewLogScreen } from './screens/BrewLogScreen';
import { BrewScreen } from './screens/BrewScreen';
import { BrewTimerScreen } from './screens/BrewTimerScreen';
import { ComingSoonScreen } from './screens/ComingSoonScreen';
import { CompareScreen } from './screens/CompareScreen';
import { ImportScreen } from './screens/ImportScreen';
import { LineageScreen } from './screens/LineageScreen';
import { MembersScreen } from './screens/MembersScreen';
import { RecipeDetailScreen } from './screens/RecipeDetailScreen';
import { RecipeFormScreen } from './screens/RecipeFormScreen';
import { RecipesScreen } from './screens/RecipesScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SetupScreen } from './screens/SetupScreen';
import { SignInScreen } from './screens/SignInScreen';
import { startBrewSync } from './offline/brewSync';
import { beansQuery, invalidateLibrary, recipesQuery } from './queries';
import { useScrollToTop } from './scroll';
import { MeProvider, meQuery, setupStatusQuery } from './session';
import { strings } from './strings';

export function App() {
  const status = useQuery(setupStatusQuery);
  const me = useQuery({ ...meQuery, enabled: status.data?.needs_setup === false });

  // Data first: when offline, the saved copy keeps the app usable even though fetches fail.
  if (status.data?.needs_setup) return <SetupScreen />;
  if (me.data) return <Shell me={me.data} />;
  if (me.data === null) return <SignInScreen />;
  if (status.isError) return <LoadError error={status.error} retry={() => void status.refetch()} />;
  if (me.isError) return <LoadError error={me.error} retry={() => void me.refetch()} />;
  return <Splash />;
}

function Shell({ me }: { me: MeResponse }) {
  const isOwner = me.member.role === 'owner';
  const qc = useQueryClient();
  const memberId = me.member.id;
  // Brews saved offline go up whenever the connection comes back.
  useEffect(() => startBrewSync(memberId, () => void invalidateLibrary(qc)), [memberId, qc]);
  // Put the recipes and beans on the phone right after sign-in (the offline copy saves them),
  // so the timer and the log work offline even if nobody opened those tabs first.
  useEffect(() => {
    void qc.prefetchQuery(recipesQuery('all', null));
    void qc.prefetchQuery(beansQuery);
  }, [memberId, qc]);
  useScrollToTop();
  return (
    <MeProvider value={me}>
      <div className="app">
        <Switch>
          <Route path="/" component={BoardScreen} />
          <Route path="/beans" component={BeansScreen} />
          <Route path="/beans/new">
            <BeanFormScreen />
          </Route>
          <Route path="/beans/:id">{(p) => <BeanFormScreen id={p.id} />}</Route>
          <Route path="/recipes" component={RecipesScreen} />
          <Route path="/recipes/new">
            <RecipeFormScreen />
          </Route>
          <Route path="/recipes/:id/edit">{(p) => <RecipeFormScreen editId={p.id} />}</Route>
          <Route path="/recipes/:id/compare">{(p) => <CompareScreen id={p.id} />}</Route>
          <Route path="/recipes/:id/lineage">{(p) => <LineageScreen id={p.id} />}</Route>
          <Route path="/recipes/:id">{(p) => <RecipeDetailScreen id={p.id} />}</Route>
          <Route path="/brew" component={BrewScreen} />
          <Route path="/brew/:id/log">{(p) => <BrewLogScreen id={p.id} />}</Route>
          <Route path="/brew/:id">{(p) => <BrewTimerScreen id={p.id} />}</Route>
          <Route path="/duel">
            <ComingSoonScreen section="duel" />
          </Route>
          <Route path="/coach">
            <ComingSoonScreen section="coach" />
          </Route>
          <Route path="/settings" component={SettingsScreen} />
          <Route path="/settings/members">{isOwner ? <MembersScreen /> : <Redirect to="/settings" replace />}</Route>
          <Route path="/settings/import">{isOwner ? <ImportScreen /> : <Redirect to="/settings" replace />}</Route>
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
