/** Human-owned professional configuration and explicit dependency selections. */
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { StudioRoleConfig } from '@deepseek-ai/dsh-api-remotes/client'
import type { createMulticaStore, MulticaDrafts } from './drafts.ts'
import type { StudioActions, StudioState } from './studio.ts'
import { roleKeys } from './locales.ts'
import css from './Workspace.module.css'

type RoleProps = PropsLocale<'multica'> &
  Pick<PropsStore<ReturnType<typeof createMulticaStore>>, 'actions'> & {
    state: MulticaDrafts
    studio: StudioState
    studioActions: StudioActions
  }

/** Validate human configuration before sending it to the server's dependency checks.
 * @param config - complete role draft.
 * @returns whether all scalar settings are usable.
 */
export function validRoleConfig(config: StudioRoleConfig): boolean {
  return (
    config.persona.trim().length > 0 &&
    Number.isSafeInteger(config.maxTokens) &&
    config.maxTokens > 0 &&
    Number.isSafeInteger(config.maxSteps) &&
    config.maxSteps > 0 &&
    Number.isSafeInteger(config.timeoutMs) &&
    config.timeoutMs > 0 &&
    config.timeoutMs <= 2_147_483_647 &&
    ((config.provider === null && config.model === null) || (!!config.provider?.trim() && !!config.model?.trim()))
  )
}

/** @param props - role source, unpublished drafts, and human callbacks. @returns configuration editor. */
export function RoleSettings({ state, studio, studioActions, actions, t }: RoleProps) {
  const roleOrder = Object.keys(roleKeys)
  const orderedRoles = [...studio.roles].sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role))
  const role = studio.roles.find(role => role.role === state.selectedRole)
  const draft = state.roleDrafts[state.selectedRole]
  const config = draft?.dirty ? draft.config : role?.config
  const changed = draft?.dirty === true
  const conflict = changed && role !== undefined && draft.role.revision !== role.revision
  const update = (patch: Partial<StudioRoleConfig>): void => {
    if (role) actions.editRole(role, patch)
  }
  return (
    <div className={css.management}>
      <header className={css.heading}>
        <div>
          <Button
            onClick={() => {
              actions.manage(null)
            }}
          >
            {t('backToWorkspace')}
          </Button>
          <h1>{t('agentConfig')}</h1>
          <p>{t('agentConfigHint')}</p>
        </div>
        <Button disabled={studio.loading} onClick={() => void studioActions.catalog()}>
          {t('refresh')}
        </Button>
      </header>
      {studio.loading && <p role="status">{t('loading')}</p>}
      {studio.error !== null && (
        <div role="alert" className={css.notice}>
          <p>{t('assistantFailure')}</p>
          <p>{studio.error}</p>
        </div>
      )}
      <div className={css.roleLayout}>
        <nav className={css.roleList} aria-label={t('agentConfig')}>
          {orderedRoles.map(item => (
            <Button
              key={item.role}
              aria-current={state.selectedRole === item.role ? 'page' : undefined}
              className={state.selectedRole === item.role ? css.selected : undefined}
              onClick={() => {
                actions.selectRole(item.role)
              }}
            >
              {t(roleKeys[item.role])}
            </Button>
          ))}
        </nav>
        {role && config ? (
          <form
            className={css.roleForm}
            onSubmit={(event) => {
              event.preventDefault()
              if (changed && !conflict && validRoleConfig(config)) void studioActions.publish(draft.role, config, draft.edit)
            }}
          >
            <header className={css.heading}>
              <h2>{t(roleKeys[role.role])}</h2>
              <span className={css.badge}>{t('roleVersion', { revision: role.revision })}</span>
            </header>
            <p>{t(studio.catalog?.enabledRoles.includes(role.role) ? 'roleReady' : 'roleLater')}</p>
            {conflict && (
              <p role="alert" className={css.notice}>
                {t('roleConflict')}
              </p>
            )}
            <fieldset className={css.fields} disabled={studio.publishing}>
              <label className={css.checkRow}>
                <input
                  type="checkbox"
                  checked={config.provider === null && config.model === null}
                  onChange={(event) => {
                    update(
                      event.target.checked
                        ? { provider: null, model: null }
                        : { provider: studio.catalog?.defaultModel?.provider ?? '', model: studio.catalog?.defaultModel?.model ?? '' },
                    )
                  }}
                />
                {t('inheritModel')}
              </label>
              {studio.catalog?.defaultModel && <p>{t('defaultModel', { ...studio.catalog.defaultModel })}</p>}
              {config.provider !== null && (
                <div className={css.columns}>
                  <label className={css.field}>
                    {t('provider')}
                    <Input
                      value={config.provider}
                      onChange={(event) => {
                        update({ provider: event.target.value })
                      }}
                    />
                  </label>
                  <label className={css.field}>
                    {t('model')}
                    <Input
                      value={config.model ?? ''}
                      onChange={(event) => {
                        update({ model: event.target.value })
                      }}
                    />
                  </label>
                </div>
              )}
              <label className={css.field}>
                {t('persona')}
                <textarea
                  rows={8}
                  value={config.persona}
                  onChange={(event) => {
                    update({ persona: event.target.value })
                  }}
                />
              </label>
              <div className={css.roleLimits}>
                <label className={css.field}>
                  {t('maxTokens')}
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={config.maxTokens}
                    onChange={(event) => {
                      update({ maxTokens: Number(event.target.value) })
                    }}
                  />
                </label>
                <label className={css.field}>
                  {t('maxSteps')}
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={config.maxSteps}
                    onChange={(event) => {
                      update({ maxSteps: Number(event.target.value) })
                    }}
                  />
                </label>
                <label className={css.field}>
                  {t('timeoutSeconds')}
                  <Input
                    type="number"
                    min={0.001}
                    step="any"
                    value={config.timeoutMs / 1000}
                    onChange={(event) => {
                      update({ timeoutMs: Number(event.target.value) * 1000 })
                    }}
                  />
                </label>
              </div>
            </fieldset>
            <fieldset className={css.fields} disabled={studio.publishing}>
              <legend>{t('skills')}</legend>
              {studio.catalog?.skills.length === 0 && <p>{t('noSkills')}</p>}
              {[...new Set([...(studio.catalog?.skills.map(skill => skill.name) ?? []), ...config.skills])].map(name => (
                <label className={css.checkRow} key={name}>
                  <input
                    type="checkbox"
                    checked={config.skills.includes(name)}
                    onChange={(event) => {
                      update({ skills: event.target.checked ? [...config.skills, name] : config.skills.filter(value => value !== name) })
                    }}
                  />
                  <span>
                    {name}
                    <small>{studio.catalog?.skills.find(skill => skill.name === name)?.description}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <fieldset className={css.fields} disabled={studio.publishing}>
              <legend>{t('contextTools')}</legend>
              {studio.catalog?.tools.length === 0 && <p>{t('noContextTools')}</p>}
              {[...new Set([...(studio.catalog?.tools.map(tool => tool.name) ?? []), ...config.tools])].map((name) => {
                const tool = studio.catalog?.tools.find(tool => tool.name === name)
                return (
                  <label className={css.checkRow} key={name}>
                    <input
                      type="checkbox"
                      checked={config.tools.includes(name)}
                      onChange={(event) => {
                        update({ tools: event.target.checked ? [...config.tools, name] : config.tools.filter(value => value !== name) })
                      }}
                    />
                    <span>
                      {name === 'studio_read_approved' ? t('readApproved') : name}
                      <small>{tool?.description}</small>
                    </span>
                    <span className={css.badge}>{tool ? t(tool.source) : t('roleLater')}</span>
                  </label>
                )
              })}
            </fieldset>
            {!validRoleConfig(config) && <p role="alert">{t('roleInvalid')}</p>}
            <footer className={css.saveBar}>
              <p>{t('rolePublishHint')}</p>
              <div className={css.row}>
                <Button
                  disabled={!changed || studio.publishing}
                  onClick={() => {
                    actions.resetRole(role.role)
                  }}
                >
                  {t('resetRole')}
                </Button>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={
                    !changed || conflict || studio.publishing || !validRoleConfig(config) || studio.catalog?.backendAvailable !== true
                  }
                >
                  {t('publishRole')}
                </Button>
              </div>
            </footer>
          </form>
        ) : (
          <p>{t('assistantUnavailable')}</p>
        )}
        <aside className={css.permissionSummary}>
          <h2>{t('capabilities')}</h2>
          <p>{t('rolePermissions')}</p>
          <p>{t('rolePublishHint')}</p>
        </aside>
      </div>
    </div>
  )
}
