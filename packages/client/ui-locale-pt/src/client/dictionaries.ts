/** pt-BR dictionaries, one per registered locale namespace. */
import { pt as agent_team } from './pt/agent-team.ts'
import { pt as approval } from './pt/approval.ts'
import { pt as chat } from './pt/chat.ts'
import { pt as command } from './pt/command.ts'
import { pt as common } from './pt/common.ts'
import { pt as conversation } from './pt/conversation.ts'
import { pt as cordis } from './pt/cordis.ts'
import { pt as costreport } from './pt/costreport.ts'
import { pt as deliverables } from './pt/deliverables.ts'
import { pt as directory_browser } from './pt/directory-browser.ts'
import { pt as documenthtml } from './pt/documenthtml.ts'
import { pt as documentmarkdown } from './pt/documentmarkdown.ts'
import { pt as feedback } from './pt/feedback.ts'
import { pt as goal } from './pt/goal.ts'
import { pt as model } from './pt/model.ts'
import { pt as open_in_app } from './pt/open-in-app.ts'
import { pt as parallel_sessions } from './pt/parallel-sessions.ts'
import { pt as permission_access } from './pt/permission-access.ts'
import { pt as plan } from './pt/plan.ts'
import { pt as pluginmanager } from './pt/pluginmanager.ts'
import { pt as question } from './pt/question.ts'
import { pt as reference } from './pt/reference.ts'
import { pt as schedule_catalog } from './pt/schedule-catalog.ts'
import { pt as schedule_manager } from './pt/schedule-manager.ts'
import { pt as session_log_download } from './pt/session-log-download.ts'
import { pt as settings } from './pt/settings.ts'
import { pt as settings_account } from './pt/settings-account.ts'
import { pt as settings_agentloop } from './pt/settings-agentloop.ts'
import { pt as settings_agentpreset } from './pt/settings-agentpreset.ts'
import { pt as settings_locale } from './pt/settings-locale.ts'
import { pt as settings_models } from './pt/settings-models.ts'
import { pt as settings_permission } from './pt/settings-permission.ts'
import { pt as settings_plugininventory } from './pt/settings-plugininventory.ts'
import { pt as settings_plugins } from './pt/settings-plugins.ts'
import { pt as settings_sessionlog } from './pt/settings-sessionlog.ts'
import { pt as settings_shell } from './pt/settings-shell.ts'
import { pt as settings_subagent } from './pt/settings-subagent.ts'
import { pt as settings_theme } from './pt/settings-theme.ts'
import { pt as settings_websearch } from './pt/settings-websearch.ts'
import { pt as shortcuts } from './pt/shortcuts.ts'
import { pt as shortcuts_layout } from './pt/shortcuts-layout.ts'
import { pt as sidebar } from './pt/sidebar.ts'
import { pt as sidebarbrowser } from './pt/sidebarbrowser.ts'
import { pt as sidebarcodepreview } from './pt/sidebarcodepreview.ts'
import { pt as sidebarcosts } from './pt/sidebarcosts.ts'
import { pt as sidebardocumentpreview } from './pt/sidebardocumentpreview.ts'
import { pt as sidebarexcel } from './pt/sidebarexcel.ts'
import { pt as sidebarfiles } from './pt/sidebarfiles.ts'
import { pt as sidebarimage } from './pt/sidebarimage.ts'
import { pt as sidebaroffice } from './pt/sidebaroffice.ts'
import { pt as sidebarpdf } from './pt/sidebarpdf.ts'
import { pt as sidebarright } from './pt/sidebarright.ts'
import { pt as sidebarterminal } from './pt/sidebarterminal.ts'
import { pt as slash_menu } from './pt/slash-menu.ts'
import { pt as trajectory } from './pt/trajectory.ts'
import { pt as voice_input } from './pt/voice-input.ts'
import { pt as workflowrun } from './pt/workflowrun.ts'
import { pt as workspace } from './pt/workspace.ts'

export const dictionaries: Record<string, Record<string, string>> = {
  'agent-team': agent_team,
  'approval': approval,
  'chat': chat,
  'command': command,
  'common': common,
  'conversation': conversation,
  'cordis': cordis,
  'costReport': costreport,
  'deliverables': deliverables,
  'directory-browser': directory_browser,
  'documentHtml': documenthtml,
  'documentMarkdown': documentmarkdown,
  'feedback': feedback,
  'goal': goal,
  'model': model,
  'open-in-app': open_in_app,
  'permission.access': permission_access,
  'parallelSessions': parallel_sessions,
  'plan': plan,
  'pluginManager': pluginmanager,
  'question': question,
  'reference': reference,
  'schedule.catalog': schedule_catalog,
  'schedule.manager': schedule_manager,
  'session-log-download': session_log_download,
  'settings': settings,
  'settings.account': settings_account,
  'settings.agentLoop': settings_agentloop,
  'settings.agentPreset': settings_agentpreset,
  'settings.locale': settings_locale,
  'settings.models': settings_models,
  'settings.permission': settings_permission,
  'settings.pluginInventory': settings_plugininventory,
  'settings.plugins': settings_plugins,
  'settings.sessionLog': settings_sessionlog,
  'settings.shell': settings_shell,
  'settings.subagent': settings_subagent,
  'settings.theme': settings_theme,
  'settings.webSearch': settings_websearch,
  'shortcuts': shortcuts,
  'shortcuts.layout': shortcuts_layout,
  'sidebar': sidebar,
  'sidebarBrowser': sidebarbrowser,
  'sidebarCodePreview': sidebarcodepreview,
  'sidebarCosts': sidebarcosts,
  'sidebarDocumentPreview': sidebardocumentpreview,
  'sidebarExcel': sidebarexcel,
  'sidebarFiles': sidebarfiles,
  'sidebarImage': sidebarimage,
  'sidebarOffice': sidebaroffice,
  'sidebarPdf': sidebarpdf,
  'sidebarRight': sidebarright,
  'sidebarTerminal': sidebarterminal,
  'slash.menu': slash_menu,
  'trajectory': trajectory,
  'voice-input': voice_input,
  'workflowRun': workflowrun,
  'workspace': workspace,
}
