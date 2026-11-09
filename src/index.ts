import {
  AppWrapperRoute,
  ApplicationFileExtension,
  ApplicationInformation,
  defineWebApplication
} from '@ownclouders/web-pkg'
import { RouteRecordRaw } from 'vue-router'
import { useGettext } from 'vue3-gettext'
import TypstEditor from './App.vue'

export default defineWebApplication({
  setup() {
    const { $gettext } = useGettext()

    const appId = 'typst'

    // registers .typ files to open in this app and adds "New > Typst document"
    // to the files app's create menu
    const typstFileLabel = () => $gettext('Typst document')
    const fileExtensions: ApplicationFileExtension[] = [
      {
        extension: 'typ',
        label: typstFileLabel,
        newFileMenu: {
          menuTitle: typstFileLabel
        }
      }
    ]

    const routes: RouteRecordRaw[] = [
      {
        path: '/:driveAliasAndItem(.*)?',
        component: AppWrapperRoute(TypstEditor, {
          applicationId: appId
        }),
        // must equal the app id: the files app resolves editor routes by `<appId>-<appId>`
        name: appId,
        meta: {
          authContext: 'hybrid',
          title: $gettext('Typst'),
          patchCleanPath: true
        }
      }
    ]

    const appInfo: ApplicationInformation = {
      name: $gettext('Typst'),
      id: appId,
      icon: 'file-text',
      color: '#239dad',
      defaultExtension: 'typ',
      extensions: fileExtensions
    }

    return {
      appInfo,
      routes
    }
  }
})
