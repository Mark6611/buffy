#import "CloudSyncSafeContainer.h"
#import <CloudKit/CloudKit.h>

@implementation CloudSyncSafeContainer

+ (nullable CKContainer *)defaultContainer {
	@try {
		return [CKContainer defaultContainer];
	}
	@catch (NSException *exception) {
		NSLog(@"[CloudSync] CKContainer.default() threw %@: %@ — treating iCloud as unavailable.",
			  exception.name, exception.reason);
		return nil;
	}
}

@end
