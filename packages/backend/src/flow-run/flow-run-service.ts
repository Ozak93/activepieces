import {
  apId,
  Collection,
  CollectionId,
  CollectionVersion,
  CollectionVersionId,
  Cursor,
  ExecutionOutputStatus,
  FileId,
  FlowRun,
  FlowRunId,
  FlowVersion,
  FlowVersionId,
  InstanceId,
  ProjectId,
  SeekPage,
} from "shared";
import { collectionVersionService } from "../collections/collection-version/collection-version.service";
import { collectionService } from "../collections/collection.service";
import { databaseConnection } from "../database/database-connection";
import { flowVersionService } from "../flows/flow-version/flow-version.service";
import { ActivepiecesError, ErrorCode } from "../helper/activepieces-error";
import { buildPaginator } from "../helper/pagination/build-paginator";
import { paginationHelper } from "../helper/pagination/pagination-utils";
import { Order } from "../helper/pagination/paginator";
import { FlowRunEntity } from "./flow-run-entity";
import { flowRunSideEffects } from "./flow-run-side-effects";

export const repo = databaseConnection.getRepository(FlowRunEntity);

export const flowRunService = {
  async list({ projectId, cursor, limit }: ListParams): Promise<SeekPage<FlowRun>> {
    const decodedCursor = paginationHelper.decodeCursor(cursor);
    const paginator = buildPaginator({
      entity: FlowRunEntity,
      paginationKeys: ["created"],
      query: {
        limit,
        order: Order.DESC,
        afterCursor: decodedCursor.nextCursor,
        beforeCursor: decodedCursor.previousCursor,
      },
    });

    const query = repo
      .createQueryBuilder("flow_run")
      .where({
        projectId,
      })
      .andWhere("flow_run.instanceId is not null");
    const { data, cursor: newCursor } = await paginator.paginate(query);
    return paginationHelper.createPage<FlowRun>(data, newCursor);
  },

  async finish(flowRunId: FlowRunId, status: ExecutionOutputStatus, logsFileId: FileId): Promise<FlowRun | null> {
    await repo.update(flowRunId, {
      logsFileId,
      status,
      finishTime: new Date().toISOString(),
    });
    return await this.getOne({ id: flowRunId });
  },

  async start({ instanceId, flowVersionId, collectionVersionId, payload }: StartParams): Promise<FlowRun> {
    console.log(`[flowRunService#start] instanceId=${instanceId} flowVersionId=${flowVersionId}`);

    const flowVersion = await getFlowVersionOrThrow(flowVersionId);
    const collectionVersion = await getCollectionVersionOrThrow(collectionVersionId);
    const collection = await getCollectionOrThrow(collectionVersion.collectionId);

    const flowRun: Partial<FlowRun> = {
      id: apId(),
      instanceId,
      projectId: collection.projectId,
      collectionId: collectionVersion.collectionId,
      flowId: flowVersion.flowId,
      flowVersionId: flowVersion.id,
      collectionVersionId: collectionVersion.id,
      flowDisplayName: flowVersion.displayName,
      collectionDisplayName: collectionVersion.displayName,
      status: ExecutionOutputStatus.RUNNING,
      startTime: new Date().toISOString(),
    };

    const savedFlowRun = await repo.save(flowRun);

    await flowRunSideEffects.start({
      flowRun: savedFlowRun,
      payload,
    });

    return savedFlowRun;
  },

  async getOne({ id }: GetOneParams): Promise<FlowRun | null> {
    return await repo.findOneBy({
      id,
    });
  },
};

const getFlowVersionOrThrow = async (id: FlowVersionId): Promise<FlowVersion> => {
  const flowVersion = await flowVersionService.getOne(id);

  if (flowVersion === null) {
    throw new ActivepiecesError({
      code: ErrorCode.FLOW_VERSION_NOT_FOUND,
      params: {
        id,
      },
    });
  }

  return flowVersion;
};

const getCollectionVersionOrThrow = async (id: CollectionVersionId): Promise<CollectionVersion> => {
  const collectionVersion = await collectionVersionService.getOne(id);

  if (collectionVersion === null) {
    throw new ActivepiecesError({
      code: ErrorCode.COLLECTION_VERSION_NOT_FOUND,
      params: {
        id,
      },
    });
  }

  return collectionVersion;
};

const getCollectionOrThrow = async (id: CollectionId): Promise<Collection> => {
  const collection = await collectionService.getOne(id, null);

  if (collection === null) {
    throw new ActivepiecesError({
      code: ErrorCode.COLLECTION_NOT_FOUND,
      params: {
        id,
      },
    });
  }

  return collection;
};

interface ListParams {
  projectId: ProjectId;
  cursor: Cursor | null;
  limit: number;
}

interface GetOneParams {
  id: FlowRunId;
}

interface StartParams {
  instanceId: InstanceId | null;
  flowVersionId: FlowVersionId;
  collectionVersionId: CollectionVersionId;
  payload: unknown;
}