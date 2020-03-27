import {Injectable} from '@angular/core';
import {PersistenceService} from '../persistence/persistence.service';
import {ProjectState} from '../../features/project/store/project.reducer';
import {EMPTY, from, Observable, of} from 'rxjs';
import {TaskArchive, TaskState} from 'src/app/features/tasks/task.model';
import {Dictionary, EntityState} from '@ngrx/entity';
import {TaskAttachment} from '../../features/tasks/task-attachment/task-attachment.model';
import {TaskRepeatCfgState} from '../../features/task-repeat-cfg/task-repeat-cfg.model';
import {initialTaskRepeatCfgState} from '../../features/task-repeat-cfg/store/task-repeat-cfg.reducer';
import {T} from '../../t.const';
import {TranslateService} from '@ngx-translate/core';
import {LegacyAppDataComplete} from './legacy-models';
import {LegacyPersistenceService} from './legacy-persistence.sevice';
import {AppDataComplete} from '../../imex/sync/sync.model';
import {initialTaskState} from '../../features/tasks/store/task.reducer';
import {initialTagState} from '../../features/tag/store/tag.reducer';
import {initialContextState} from '../../features/work-context/store/work-context.reducer';
import {Project} from '../../features/project/project.model';
import {concatMap, map} from 'rxjs/operators';
import {migrateTaskState} from '../../features/tasks/migrate-task-state.util';


const EMTPY_ENTITY = () => ({ids: [], entities: {}});

@Injectable({
  providedIn: 'root'
})
export class MigrationService {


  constructor(
    private _persistenceService: PersistenceService,
    private _legacyPersistenceService: LegacyPersistenceService,
    private _translateService: TranslateService,
  ) {
  }

  migrateIfNecessaryToProjectState$(projectState: ProjectState): Observable<ProjectState | never> {
    const isNeedsMigration = this._isNeedsMigration(projectState);
    console.log('IS NEEDS MIGRATION', isNeedsMigration);

    if (isNeedsMigration && this._isConfirmMigrateDialog()) {
      return from(this._legacyPersistenceService.loadCompleteLegacy()).pipe(
        map((legacyData) => this._migrate(legacyData)),
        concatMap((migratedData) => this._persistenceService.importComplete(migratedData)),
        concatMap((migratedData) => this._persistenceService.cleanDatabase()),
        concatMap(() => this._persistenceService.project.loadState()),
      );
    }

    return isNeedsMigration
      ? EMPTY
      : of(projectState);
  }


  migrateIfNecessary(appDataComplete: LegacyAppDataComplete | AppDataComplete): AppDataComplete {
    const projectState = appDataComplete.project;
    const isNeedsMigration = this._isNeedsMigration(projectState);
    if (isNeedsMigration) {
      const legacyAppDataComplete = appDataComplete as LegacyAppDataComplete;
      if (this._isConfirmMigrateDialog()) {
        return this._migrate(legacyAppDataComplete);
      }
    } else {
      return appDataComplete as AppDataComplete;
    }
  }

  private _migrate(legacyAppDataComplete: LegacyAppDataComplete): AppDataComplete {
    const ids = legacyAppDataComplete.project.ids as string[];
    console.log('legacyAppDataComplete', legacyAppDataComplete);
    console.log('projectIds', ids);

    const newAppData: AppDataComplete = {
      lastActiveTime: legacyAppDataComplete.lastActiveTime,
      archivedProjects: legacyAppDataComplete.archivedProjects,
      globalConfig: legacyAppDataComplete.globalConfig,
      reminders: legacyAppDataComplete.reminders,
      // new
      tag: initialTagState,
      context: initialContextState,
      // migrated
      project: {
        ...this._mTaskListsFromTaskToProjectState(legacyAppDataComplete),
        __modelVersion: 4,
      } as any,
      taskRepeatCfg: this._mTaskRepeatCfg(legacyAppDataComplete),

      task: this._mTaskState(legacyAppDataComplete),
      taskArchive: this._mTaskArchiveState(legacyAppDataComplete),
    };

    console.log('DATA AFTER MIGRATIONS', newAppData);

    return newAppData;
  }

  private _mTaskListsFromTaskToProjectState(legacyAppDataComplete: LegacyAppDataComplete): ProjectState {
    const projectStateBefore = legacyAppDataComplete.project;
    return {
      ...projectStateBefore,
      entities: (projectStateBefore.ids as string[]).reduce((acc, id): Dictionary<Project> => {
        const taskState = legacyAppDataComplete.task[id] || {};
        return {
          ...acc,
          [id]: {
            ...projectStateBefore.entities[id],
            taskIds: (taskState as any).todaysTaskIds || [],
            backlogTaskIds: (taskState as any).backlogTaskIds || [],
          } as Project
        };
      }, {})
    };
  }


  private _mTaskState(legacyAppDataComplete: LegacyAppDataComplete): TaskState {
    const singleState = this._mTaskFromProjectToSingle(legacyAppDataComplete);
    const standardMigration = migrateTaskState(singleState as TaskState);
    return this._mTaskAttachmentsToTaskStates(legacyAppDataComplete, standardMigration) as TaskState;
  }

  private _mTaskArchiveState(legacyAppDataComplete: LegacyAppDataComplete): TaskArchive {
    const singleState = this._mTaskArchiveFromProjectToSingle(legacyAppDataComplete) as TaskArchive;
    const standardMigration = migrateTaskState(singleState as TaskState);
    return this._mTaskAttachmentsToTaskStates(legacyAppDataComplete, standardMigration) as TaskArchive;
  }

  private _mTaskRepeatCfg(legacyAppDataComplete: LegacyAppDataComplete): TaskRepeatCfgState {
    const pids = legacyAppDataComplete.project.ids as string[];

    const repeatStates: TaskRepeatCfgState[] = pids.map((projectId) => {
      const repeatState = legacyAppDataComplete.taskRepeatCfg[projectId];
      if (!repeatState) {
        return null;
      }

      // add projectId to model
      return {
        ...repeatState,
        entities: (repeatState.ids as string[]).reduce((acc, entityId) => {
          return {
            ...acc,
            [entityId]: {
              ...repeatState.entities[entityId],
              projectId,
              tagIds: [],
            }
          };
        }, {})
      };
    });

    return this._mergeEntities(repeatStates, initialTaskRepeatCfgState) as TaskRepeatCfgState;
  }

  private _mTaskFromProjectToSingle(legacyAppDataComplete: LegacyAppDataComplete): TaskState {
    const pids = legacyAppDataComplete.project.ids as string[];
    const taskStates: TaskState[] = pids.map((id) => legacyAppDataComplete.task[id]);
    return this._mergeEntities(taskStates, initialTaskState) as TaskState;
  }

  private _mTaskArchiveFromProjectToSingle(legacyAppDataComplete: LegacyAppDataComplete): TaskArchive {
    const pids = legacyAppDataComplete.project.ids as string[];
    const taskStates: TaskArchive[] = pids.map((id) => legacyAppDataComplete.taskArchive[id]);
    return this._mergeEntities(taskStates, EMTPY_ENTITY()) as TaskArchive;
  }

  private _mTaskRepeatFromProjectIntoSingle(legacyAppDataComplete: LegacyAppDataComplete): TaskRepeatCfgState {
    const pids = legacyAppDataComplete.project.ids as string[];
    const taskStates: TaskRepeatCfgState[] = pids.map((id) => legacyAppDataComplete.taskRepeatCfg[id]);
    return this._mergeEntities(taskStates, initialTaskRepeatCfgState) as TaskRepeatCfgState;
  }


  private _mTaskAttachmentsToTaskStates(legacyAppDataComplete: LegacyAppDataComplete, taskState: (TaskState | TaskArchive)):
    TaskState | TaskArchive {
    const attachmentStates = Object.keys(legacyAppDataComplete.taskAttachment).map(id => legacyAppDataComplete.taskAttachment[id]);
    const allAttachmentState = this._mergeEntities(attachmentStates, initialTaskRepeatCfgState) as EntityState<TaskAttachment>;

    return (taskState.ids as string[]).reduce((acc, id) => {
      const {attachmentIds, ...tEnt} = acc.entities[id] as any;
      return {
        ...acc,
        entities: {
          ...acc.entities,
          [id]: {
            ...tEnt,
            attachments: tEnt.attachments || (attachmentIds
              ? attachmentIds.map(attachmentId => {
                const result = allAttachmentState.entities[attachmentId];
                if (!result) {
                  console.log('ATTACHMENT NOT FOUND: Will be removed', attachmentIds);
                  // throw new Error('Attachment not found');
                } else {
                  console.log('ATTACHMENT FOUND', result.title);
                }
                return result;
              }).filter(v => !!v)
              : [])
          },
        }
      };
    }, taskState);
  }

  private _mergeEntities(states: EntityState<any>[], initial: EntityState<any>): EntityState<any> {
    return states.reduce(
      (acc, s) => {
        if (!s || !s.ids) {
          return acc;
        }
        return {
          ...acc,
          ids: [...acc.ids, ...s.ids] as string[],
          entities: {...acc.entities, ...s.entities}
        };
      }, initial
    );
  }

  private _isNeedsMigration(projectState: ProjectState): boolean {
    return (projectState && (!(projectState as any).__modelVersion || (projectState as any).__modelVersion <= 3));
  }

  private _isConfirmMigrateDialog(): boolean {
    const msg = this._translateService.instant(T.APP.UPDATE_MAIN_MODEL);
    const r = confirm(msg);
    if (r !== true) {
      alert(this._translateService.instant(T.APP.UPDATE_MAIN_MODEL_NO_UPDATE));
    }
    return r;
  }
}
