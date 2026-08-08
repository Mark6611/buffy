# Generates BuffyNative.xcodeproj from the sources in BuffyNative/.
#
# The project file is GENERATED rather than committed: a hand-maintained pbxproj is
# the most merge-hostile file in an iOS repo, and this pilot has exactly one target
# with no storyboards, no asset catalog and no build phases beyond compile+resources.
# Re-run after adding a source file:  ruby generate-project.rb
#
# Uses the same xcodeproj gem scripts/ship.sh already depends on, so there is no new
# toolchain requirement. Deliberately writes to native-pilot/ only — the shipping
# app's ios/App/App.xcodeproj is never opened.
require 'xcodeproj'
require 'fileutils'

ROOT = File.dirname(File.expand_path(__FILE__))
PROJECT_PATH = File.join(ROOT, 'BuffyNative.xcodeproj')
SOURCE_DIR = File.join(ROOT, 'BuffyNative')

FileUtils.rm_rf(PROJECT_PATH)
project = Xcodeproj::Project.new(PROJECT_PATH)

target = project.new_target(:application, 'BuffyNative', :ios, '17.0')

group = project.new_group('BuffyNative', 'BuffyNative')
Dir.glob(File.join(SOURCE_DIR, '*.swift')).sort.each do |path|
  ref = group.new_reference(File.basename(path))
  target.add_file_references([ref])
end

# Info.plist is synthesised by the build system (GENERATE_INFOPLIST_FILE) so there
# is no plist to keep in sync with these settings.
target.build_configurations.each do |config|
  config.build_settings.merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.mark.buffy.native',
    'PRODUCT_NAME' => 'BuffyNative',
    'MARKETING_VERSION' => '0.1',
    'CURRENT_PROJECT_VERSION' => '1',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'INFOPLIST_KEY_UILaunchScreen_Generation' => 'YES',
    'INFOPLIST_KEY_CFBundleDisplayName' => 'Buffy Native',
    # portrait only, matching the shipping app's phone-first layout
    'INFOPLIST_KEY_UISupportedInterfaceOrientations' => 'UIInterfaceOrientationPortrait',
    'SWIFT_VERSION' => '5.0',
    'IPHONEOS_DEPLOYMENT_TARGET' => '17.0',
    'TARGETED_DEVICE_FAMILY' => '1',
    'ENABLE_PREVIEWS' => 'YES',
    'SWIFT_EMIT_LOC_STRINGS' => 'YES',
    # the pilot is built for the simulator; signing is the shipping app's problem
    'CODE_SIGNING_REQUIRED' => 'NO',
    'CODE_SIGNING_ALLOWED' => 'NO',
    'CODE_SIGN_IDENTITY' => ''
  )
end

project.save
puts "wrote #{PROJECT_PATH}"
puts "sources: #{Dir.glob(File.join(SOURCE_DIR, '*.swift')).map { |f| File.basename(f) }.join(', ')}"
