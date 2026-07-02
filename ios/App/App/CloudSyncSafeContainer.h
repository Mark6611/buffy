#import <Foundation/Foundation.h>

@class CKContainer;

NS_ASSUME_NONNULL_BEGIN

/// Wraps +[CKContainer defaultContainer] in @try/@catch so a missing-iCloud-
/// entitlement CKException becomes a nil return instead of an uncaught NSException
/// that aborts the process (SIGABRT). Objective-C is the only language that can
/// catch an NSException — Swift's do/catch cannot — which is why this shim exists.
@interface CloudSyncSafeContainer : NSObject
+ (nullable CKContainer *)defaultContainer;
@end

NS_ASSUME_NONNULL_END
