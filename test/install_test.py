import importlib.util
from pathlib import Path
import unittest
import tempfile
import json
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('installer',Path(__file__).resolve().parents[1]/'scripts/install.py')
installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)

class InstallPlan(unittest.TestCase):
    def model(self):
        return {'name':'example','services':{'n8n':{'image':'n8nio/n8n:2.26.9','environment':{'DB_TYPE':'postgresdb','DB_POSTGRESDB_HOST':'postgres','DB_POSTGRESDB_PASSWORD':'NEVER_COPY_THIS'},'ports':[{'target':5678,'published':'5678','host_ip':'127.0.0.1','protocol':'tcp'}],'networks':{'default':{}}}}}
    def test_preserves_host_port_without_exporting_password(self):
        model=self.model()
        name,port,text=installer.make_overlay(model,None,Path('/private/reader-password'),'reader')
        self.assertEqual(name,'n8n');self.assertEqual(port['published'],'5678')
        self.assertIn('ports: !override []',text)
        self.assertIn('"host_ip": "127.0.0.1"',text)
        self.assertIn('"target": 8080',text)
        self.assertNotIn('NEVER_COPY_THIS',text)
        self.assertNotIn('AUTH_PASSWORD',text)
        self.assertEqual(model['services']['n8n']['ports'][0]['target'],5678)
    def test_unsupported_installations_stop_before_mutation(self):
        for field,value in [('DB_TYPE','sqlite'),('EXECUTIONS_MODE','queue'),('N8N_PATH','/n8n/'),('DB_POSTGRESDB_SSL_ENABLED','true')]:
            model=self.model();model['services']['n8n']['environment'][field]=value
            with self.subTest(field=field), self.assertRaises(ValueError):
                installer.make_overlay(model,None,Path('/reader'),'reader')
        model=self.model();model['services']['n8n']['ports']=[]
        with self.assertRaises(ValueError):installer.discover(model)
        model=self.model();model['services']['n8n']['image']='n8nio/n8n:latest'
        with self.assertRaises(ValueError):installer.discover(model)

    def test_failed_connection_restores_original_service(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder).resolve();base=root/'compose.yaml';base.write_text('fixture')
            secret=root/'reader';secret.write_text('test-only')
            calls=[]
            def command(args,label):
                calls.append((args,label))
                if label=='Compose 버전 확인':return '2.30.0'
                if label=='Compose 읽기':return json.dumps(self.model())
                if label=='기존 n8n 실행 확인':return 'container-id'
                if label=='실행 구성 확인':return json.dumps({'com.docker.compose.project.config_files':str(base)})
                if label=='추가 기능 시작':raise ValueError('fixture startup failure')
                return ''
            with patch.object(installer,'ROOT',root), patch.object(installer,'command',side_effect=command), patch('sys.argv',['install',str(base),'--reader-secret',str(secret),'--yes']):
                with self.assertRaisesRegex(ValueError,'fixture startup failure'):installer.main()
            labels=[label for _,label in calls]
            self.assertLess(labels.index('DB 읽기 계정 사전 검사'),labels.index('n8n 포트 전환'))
            self.assertEqual(labels[-2:],['실패한 추가 서비스 정리','원래 n8n 복구'])
            self.assertEqual(calls[-1][0][-4:],['up','-d','--no-deps','n8n'])
            self.assertEqual(base.read_text(),'fixture')

if __name__=='__main__':unittest.main()
