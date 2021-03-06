package model.facia

import com.gu.commercial.branding.ContainerBranding
import com.gu.facia.api.{models => fapi}
import com.gu.facia.api.utils.ContainerBrandingFinder
import com.gu.facia.client.models.Branded
import common.Edition
import implicits.CollectionsOps._
import model.pressed._
import org.joda.time.DateTime
import services.CollectionConfigWithId

case class PressedCollection(
  id: String,
  displayName: String,
  curated: List[PressedContent],
  backfill: List[PressedContent],
  treats: List[PressedContent],
  lastUpdated: Option[DateTime],
  href: Option[String],
  description: Option[String],
  collectionType: String,
  groups: Option[List[String]],
  uneditable: Boolean,
  showTags: Boolean,
  showSections: Boolean,
  hideKickers: Boolean,
  showDateHeader: Boolean,
  showLatestUpdate: Boolean,
  config: CollectionConfig,
  hasMore: Boolean
) {

  lazy val collectionConfigWithId = CollectionConfigWithId(id, config)

  lazy val curatedPlusBackfillDeduplicated = (curated ++ backfill).distinctBy { c =>
    c.properties.maybeContentId.getOrElse(c.card.id)
  }

  lazy val distinct = curatedPlusBackfillDeduplicated.distinctBy(_.header.url)

  def branding(edition: Edition): Option[ContainerBranding] = {
    ContainerBrandingFinder.findBranding(
      isConfiguredForBranding = config.metadata.exists(_.contains(Branded)),
      optBrandings = curatedPlusBackfillDeduplicated.map(_.branding(edition)).toSet
    )
  }
}

object PressedCollection {

  def fromCollectionWithCuratedAndBackfill(
      collection: com.gu.facia.api.models.Collection,
      curated: List[PressedContent],
      backfill: List[PressedContent],
      treats: List[PressedContent]
  ): PressedCollection =
    PressedCollection(
      collection.id,
      collection.displayName,
      curated,
      backfill,
      treats,
      collection.lastUpdated,
      collection.href,
      collection.collectionConfig.description,
      collection.collectionConfig.collectionType,
      collection.collectionConfig.groups.map(groups => fapi.Group.fromGroups(groups).map(_.toString)),
      collection.collectionConfig.uneditable,
      collection.collectionConfig.showTags,
      collection.collectionConfig.showSections,
      collection.collectionConfig.hideKickers,
      collection.collectionConfig.showDateHeader,
      collection.collectionConfig.showLatestUpdate,
      CollectionConfig.make(collection.collectionConfig),
      hasMore = false
    )
}
