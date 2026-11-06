Pod::Spec.new do |s|
  s.name = 'SecureMedia'
  s.version = '1.0.0'
  s.summary = 'Authenticated encryption for bounded offline media'
  s.description = 'Keeps full-resolution cached media encrypted outside active display sessions.'
  s.author = 'Platinum Circles'
  s.homepage = 'https://platinumcircles.app'
  s.license = { :type => 'Proprietary' }
  s.platforms = { :ios => '15.1' }
  s.source = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift}'
end
